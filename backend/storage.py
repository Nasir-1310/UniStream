"""Persistent storage for accounts, daily quotas, download logs and settings.

Supabase is the single source of truth whenever its credentials are present.
The service must never silently switch to SQLite after a transient remote
failure: doing so creates two conflicting user lists and makes approvals appear
to revert after a restart. SQLite remains an explicit local-development mode
and upgrades older local database files in place.

Every function is synchronous (async routes call them via asyncio.to_thread).
Rows come back as plain dicts: ids as strings, datetimes as ISO-8601 UTC
strings with an offset, dates as YYYY-MM-DD and flags as bools.
"""

import logging
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
import uuid
from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, NamedTuple, TypeVar
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from dotenv import load_dotenv
from postgrest.exceptions import APIError, generate_default_error_message
from supabase import Client, ClientOptions, create_client


backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "auto").strip().lower()
if STORAGE_BACKEND not in {"auto", "supabase", "sqlite"}:
    raise RuntimeError("STORAGE_BACKEND must be 'auto', 'supabase', or 'sqlite'.")
SUPABASE_CONFIGURED = (
    STORAGE_BACKEND != "sqlite" and bool(SUPABASE_URL and SUPABASE_KEY)
)
VALID_STATUSES = frozenset({"approved", "pending", "blocked"})

# The committed database is used only when Supabase is not configured. On a
# read-only checkout, a writable copy is created in the process temp folder.
SEED_DB_PATH = backend_dir / "unistream_local.sqlite3"

# Deploys with rootDir=backend (Render) cannot see the repository root, so the
# backend serves its own copy of supabase_migration_v2.sql.
MIGRATION_SQL_PATH = backend_dir / "sql" / "migration_v2.sql"
_ROOT_MIGRATION_SQL_PATH = backend_dir.parent / "supabase_migration_v2.sql"

# A bounded timeout keeps a stalled Supabase request from pinning a worker
# thread for the library default of two minutes.
REMOTE_TIMEOUT_SECONDS = 30
_REMOTE_ATTEMPTS = 3
# Supabase caps every response at 1000 rows (max-rows); bigger pages would be
# silently truncated, so bulk reads walk the table in pages of this size.
REMOTE_PAGE_SIZE = 1000
MAX_USER_PAGE_SIZE = 100
MAX_LOG_PAGE_SIZE = 200
# Long titles (Facebook captions run to thousands of characters) add nothing
# to an audit log but bloat every admin page and CSV export.
MAX_LOG_TITLE_LENGTH = 500
MAX_LOG_URL_LENGTH = 2048

DEFAULT_SETTINGS = {"default_daily_limit": "4"}
_SETTINGS_TTL_SECONDS = 30
_SCHEMA_READY_TTL_SECONDS = 3600
_SCHEMA_OUTDATED_TTL_SECONDS = 30

USER_FIELDS = (
    "id", "identifier", "status", "name", "note", "email", "phone",
    "password_hash", "temp_password", "daily_limit", "downloads_today",
    "usage_date", "total_downloads", "approved_at", "credentials_sent_at",
    "last_login_at", "last_download_at", "created_at", "updated_at",
)
LOG_FIELDS = (
    "id", "user_id", "identifier", "url", "title", "platform", "quality",
    "file_size", "created_at",
)
_V1_USER_FIELDS = ("id", "identifier", "status", "name", "note", "created_at")
_USER_V2_COLUMNS = tuple(f for f in USER_FIELDS if f not in _V1_USER_FIELDS)
_LOG_V2_COLUMNS = ("user_id", "quality", "file_size")
_USER_SELECT = ",".join(USER_FIELDS)
_LOG_SELECT = ",".join(LOG_FIELDS)
_USER_TIMESTAMP_FIELDS = (
    "approved_at", "credentials_sent_at", "last_login_at", "last_download_at",
    "created_at", "updated_at",
)

UPDATABLE_USER_FIELDS = frozenset({
    "name", "email", "phone", "note", "status", "daily_limit", "password_hash",
    "temp_password", "approved_at", "credentials_sent_at", "last_login_at",
    "downloads_today", "usage_date",
})
USER_SORTS = frozenset({
    "created_at", "name", "last_login_at", "last_download_at",
    "total_downloads", "status",
})
_USER_SEARCH_COLUMNS = ("name", "email", "phone", "identifier", "note")
_LOG_SEARCH_COLUMNS = ("identifier", "title", "url")

T = TypeVar("T")


class StorageUnavailableError(RuntimeError):
    """The configured persistent store could not complete an operation."""


class SchemaOutdatedError(StorageUnavailableError):
    """Supabase is reachable but supabase_migration_v2.sql has not been run."""

    def __init__(self, detail: str | None = None):
        self.detail = detail
        super().__init__(
            "Database upgrade required: open the Supabase SQL editor and run "
            "supabase_migration_v2.sql (the admin panel's System section shows "
            "the script)."
        )


class DuplicateUserError(ValueError):
    """Another account already uses this email or phone number."""

    field: str

    def __init__(self, field: str):
        self.field = field if field in {"email", "phone"} else "email"
        super().__init__(f"Another account already uses this {self.field}.")


def _dir_is_writable(directory: Path) -> bool:
    probe = directory / ".unistream_write_probe"
    try:
        probe.touch()
        probe.unlink()
        return True
    except Exception:
        return False


def _resolve_db_path() -> Path:
    override = os.getenv("LOCAL_DB_PATH")
    if override:
        return Path(override)

    if _dir_is_writable(SEED_DB_PATH.parent):
        return SEED_DB_PATH

    runtime_path = Path(tempfile.gettempdir()) / "unistream_local.sqlite3"
    if not runtime_path.exists() and SEED_DB_PATH.exists():
        try:
            shutil.copy2(SEED_DB_PATH, runtime_path)
        except Exception:
            pass
    return runtime_path


LOCAL_DB_PATH = _resolve_db_path()

_local_lock = threading.RLock()
_local_conn: sqlite3.Connection | None = None
_local_db_error: str | None = None

_remote_lock = threading.Lock()
_supabase: Client | None = None
_last_remote_error: str | None = None
_last_remote_success: str | None = None

_cache_lock = threading.Lock()
_schema_cache: dict | None = None
_settings_cache: dict[str, tuple[str | None, float]] = {}


def normalize(identifier: str) -> str:
    return identifier.strip().lower()


# ── Value conversion ─────────────────────────────────────────────────────


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _utcnow().isoformat(timespec="seconds")


def _as_utc(value: datetime) -> datetime:
    # Naive datetimes only come from SQLite's CURRENT_TIMESTAMP, which is UTC.
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return _as_utc(value)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    try:
        return _as_utc(datetime.fromisoformat(str(value).strip()))
    except ValueError:
        return None


def _iso(value: Any) -> str | None:
    parsed = _parse_datetime(value)
    if parsed is None:
        return None if value in (None, "") else str(value)
    return parsed.isoformat(timespec="seconds")


def _db_ts(value: datetime) -> str:
    """SQLite timestamp: fixed width, so text comparison is time order.

    Matches strftime('%Y-%m-%dT%H:%M:%f+00:00') used by the local migration.
    """
    value = _as_utc(value)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}+00:00"


def _remote_ts(value: datetime) -> str:
    return _as_utc(value).isoformat()


def _date_text(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return text


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _uuid_or_none(value: Any) -> str | None:
    try:
        return str(uuid.UUID(str(value).strip()))
    except (TypeError, ValueError, AttributeError):
        return None


def _local_id_or_none(value: Any) -> int | None:
    text = str(value).strip() if value is not None else ""
    # isascii() keeps out Unicode digits; the length cap keeps the value inside
    # SQLite's 64-bit integer range.
    if text.isascii() and text.isdigit() and len(text) <= 18:
        return int(text)
    return None


def _user_from_row(row: Any) -> dict | None:
    if row is None:
        return None
    data = dict(row)
    user = {field: data.get(field) for field in USER_FIELDS}
    user["id"] = str(user["id"]) if user["id"] is not None else None
    user["temp_password"] = bool(user["temp_password"])
    user["daily_limit"] = _int_or_none(user["daily_limit"])
    user["downloads_today"] = _int_or_none(user["downloads_today"]) or 0
    user["total_downloads"] = _int_or_none(user["total_downloads"]) or 0
    user["usage_date"] = _date_text(user["usage_date"])
    for field in _USER_TIMESTAMP_FIELDS:
        user[field] = _iso(user[field])
    return user


def _log_from_row(row: Any) -> dict:
    data = dict(row)
    user_id = data.get("user_id")
    return {
        "id": str(data.get("id")),
        "user_id": str(user_id) if user_id is not None else None,
        "identifier": data.get("identifier") or "",
        "url": data.get("url") or "",
        "title": data.get("title") or "",
        "platform": data.get("platform") or "",
        "quality": data.get("quality") or None,
        "file_size": _int_or_none(data.get("file_size")),
        "created_at": _iso(data.get("created_at")),
    }


def _clean_email(value: Any) -> str | None:
    text = str(value).strip().lower() if value is not None else ""
    return text or None


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


def _check_status(status: Any) -> str:
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid user status: {status}")
    return status


def _check_int(value: Any, field: str, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer.")
    if value < minimum:
        raise ValueError(f"{field} must be {minimum} or more.")
    return value


def _check_daily_limit(value: Any) -> int | None:
    # NULL = the default_daily_limit setting; -1 = unlimited (future paid plan).
    return None if value is None else _check_int(value, "daily_limit", -1)


def _coerce_timestamp(value: Any, field: str) -> datetime | None:
    if value is None or value == "":
        return None
    parsed = _parse_datetime(value)
    if parsed is None:
        raise ValueError(f"{field} must be an ISO-8601 datetime.")
    return parsed


def _coerce_date(value: Any, field: str) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError as exc:
        raise ValueError(f"{field} must be a YYYY-MM-DD date.") from exc


def _prepare_user_changes(fields: dict) -> dict:
    """Validate update_user() input and convert it to Python values."""
    unknown = sorted(set(fields) - UPDATABLE_USER_FIELDS)
    if unknown:
        raise ValueError(f"Unknown user field(s): {', '.join(unknown)}")

    changes: dict[str, Any] = {}
    for key, value in fields.items():
        if key == "email":
            changes[key] = _clean_email(value)
        elif key in {"name", "phone", "note"}:
            changes[key] = _clean_text(value)
        elif key == "status":
            changes[key] = _check_status(value)
        elif key == "daily_limit":
            changes[key] = _check_daily_limit(value)
        elif key == "password_hash":
            changes[key] = value or None
        elif key == "temp_password":
            changes[key] = bool(value)
        elif key == "downloads_today":
            changes[key] = 0 if value is None else _check_int(value, key, 0)
        elif key == "usage_date":
            changes[key] = _coerce_date(value, key)
        else:
            changes[key] = _coerce_timestamp(value, key)
    return changes


def _new_identifier(changes: dict, current: dict | None) -> str | None:
    """The login identifier follows the email; phone-only legacy accounts
    follow their phone so an old number stops working once it is replaced."""
    if changes.get("email"):
        return changes["email"]
    if (
        changes.get("phone")
        and current is not None
        and not current.get("email")
        and "@" not in (current.get("identifier") or "")
    ):
        return changes["phone"]
    return None


_LEGACY_PHONE_PATTERNS = (
    (re.compile(r"01[3-9][0-9]{8}"), lambda s: "+880" + s[1:]),
    (re.compile(r"8801[3-9][0-9]{8}"), lambda s: "+" + s),
    (re.compile(r"\+8801[3-9][0-9]{8}"), lambda s: s),
)


def _legacy_phone(identifier: str | None) -> str | None:
    """E.164 form of a v1 Bangladeshi phone identifier (mirrors the SQL backfill)."""
    text = (identifier or "").strip()
    for pattern, convert in _LEGACY_PHONE_PATTERNS:
        if pattern.fullmatch(text):
            return convert(text)
    return None


_PLATFORM_HOSTS = (
    ("YouTube", ("youtube.com", "youtu.be", "youtube-nocookie.com")),
    ("Facebook", ("facebook.com", "fb.watch", "fb.com")),
    ("Instagram", ("instagram.com", "instagr.am")),
)
PLATFORM_LABELS = tuple(label for label, _hosts in _PLATFORM_HOSTS)


def _legacy_platform_label(platform: str | None, url: str | None) -> str | None:
    """Label for a v1 log row that stored a yt-dlp extractor name or nothing."""
    key = (platform or "").strip().lower()
    for label, _hosts in _PLATFORM_HOSTS:
        if key.startswith(label.lower()):
            return label
    try:
        parts = urlsplit(url or "")
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    if parts.scheme.lower() not in {"http", "https"}:
        return None
    for label, hosts in _PLATFORM_HOSTS:
        if any(host == h or host.endswith("." + h) for h in hosts):
            return label
    return None


def _zone(tz: str):
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        # Windows without the tzdata package has no zone database. Bangladesh
        # has no DST, so a fixed offset is exact for the default zone.
        if tz == "Asia/Dhaka":
            return timezone(timedelta(hours=6), "Asia/Dhaka")
        if tz in {"UTC", "Etc/UTC"}:
            return timezone.utc
        raise ValueError(f"Unknown time zone: {tz}") from None


# ── Search helpers (shared by both backends) ─────────────────────────────


def _clean_search(q: Any) -> str:
    """Normalise a free-text search; quotes and backslashes never occur in the
    names, emails, phones or URLs being searched, so they are dropped."""
    if not q:
        return ""
    text = "".join(ch for ch in str(q) if ch.isprintable() and ch not in '"\\')
    return " ".join(text.split())[:100]


def _like_escape(term: str) -> str:
    """Make LIKE's own wildcards (% and _) match literally."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _postgrest_quote(value: str) -> str:
    """Quote a value inside a PostgREST logic tree (or=/and=), where , . : ( )
    are syntax. PostgREST unescapes backslash sequences inside the quotes."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _postgrest_search(columns: tuple[str, ...], term: str) -> str:
    """Body of an or=(...) filter: case-insensitive substring match."""
    # PostgREST turns every "*" into "%"; a literal "*" typed by the admin
    # becomes a one-character wildcard instead of "match anything".
    pattern = "*" + _like_escape(term).replace("*", "_") + "*"
    quoted = _postgrest_quote(pattern)
    return ",".join(f"{column}.ilike.{quoted}" for column in columns)


def _local_search(columns: tuple[str, ...], term: str) -> tuple[str, list[str]]:
    pattern = "%" + _like_escape(term) + "%"
    clause = " OR ".join(f"COALESCE({column}, '') LIKE ? ESCAPE '\\'" for column in columns)
    return f"({clause})", [pattern] * len(columns)


# ── Supabase plumbing ────────────────────────────────────────────────────

# Missing column (42703 / PGRST204), function (42883 / PGRST202) or table
# (42P01 / PGRST205): the v2 migration has not been applied.
_SCHEMA_ERROR_CODES = frozenset({"42703", "42883", "42P01", "PGRST202", "PGRST204", "PGRST205"})
# PostgREST could not reach Postgres at all, so the statement never ran.
_UNREACHED_DB_CODES = frozenset({"PGRST000", "PGRST001", "PGRST002", "PGRST003"})
# SQLSTATE classes worth retrying: connection, transaction rollback
# (serialization/deadlock), resources, operator intervention (timeouts), system.
_TRANSIENT_SQLSTATE_CLASSES = ("08", "40", "53", "57", "58")
_UNREACHED_NETWORK_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
    # Usually a pooled keep-alive connection Supabase had already closed.
    httpx.RemoteProtocolError,
    ConnectionRefusedError,
)
_NETWORK_ERRORS = (httpx.HTTPError, OSError)


def _error_code(exc: BaseException) -> str:
    return str(getattr(exc, "code", "") or "") if isinstance(exc, APIError) else ""


def _error_text(exc: BaseException) -> str:
    if isinstance(exc, APIError):
        parts = (exc.message, exc.details, exc.hint)
        return " ".join(str(part) for part in parts if part)
    return str(exc)


def _is_schema_error(exc: BaseException) -> bool:
    if not isinstance(exc, APIError):
        return False
    if _error_code(exc) in _SCHEMA_ERROR_CODES:
        return True
    text = _error_text(exc).lower()
    return "schema cache" in text and "could not find" in text


def _is_unique_violation(exc: BaseException) -> bool:
    return isinstance(exc, APIError) and _error_code(exc) == "23505"


def _duplicate_field(*texts: str | None) -> str:
    """Which login column a unique violation hit (Postgres or SQLite wording)."""
    pattern = re.compile(
        r'unique constraint "([^"]+)"|Key \(([^)]+)\)|UNIQUE constraint failed: \w+\.(\w+)'
    )
    for text in texts:
        match = pattern.search(text or "")
        if match:
            name = next(group for group in match.groups() if group)
            return "phone" if "phone" in name.lower() else "email"
    return "email"


def _is_transient(exc: BaseException) -> bool:
    if isinstance(exc, APIError):
        code = _error_code(exc)
        if code in _UNREACHED_DB_CODES:
            return True
        if code.isdigit() and len(code) == 3:
            # Non-JSON gateway response; postgrest-py reports the HTTP status.
            return int(code) >= 500 or code in {"408", "429"}
        return code[:2] in _TRANSIENT_SQLSTATE_CLASSES
    return isinstance(exc, _NETWORK_ERRORS)


def _never_reached_database(exc: BaseException) -> bool:
    """True when a write certainly did not run, so retrying cannot repeat it."""
    if isinstance(exc, APIError):
        return _error_code(exc) in _UNREACHED_DB_CODES
    return isinstance(exc, _UNREACHED_NETWORK_ERRORS)


def _describe_error(exc: BaseException) -> str:
    if isinstance(exc, APIError):
        return f"APIError {_error_code(exc) or '?'}: {exc.message or 'no message'}"
    return f"{type(exc).__name__}: {exc}"


def _get_supabase() -> Client:
    global _supabase
    if not SUPABASE_CONFIGURED:
        raise StorageUnavailableError("Supabase is not configured.")

    if _supabase is None:
        with _remote_lock:
            if _supabase is None:
                _supabase = create_client(
                    SUPABASE_URL,
                    SUPABASE_KEY,
                    options=ClientOptions(postgrest_client_timeout=REMOTE_TIMEOUT_SECONDS),
                )
    return _supabase


def _remote(
    operation: str,
    callback: Callable[[Client], T],
    *,
    idempotent: bool = True,
) -> T:
    """Run a Supabase operation with retries, without changing storage mode.

    Reads and absolute updates retry any transient failure. Increments and
    inserts (idempotent=False) retry only when the request never reached the
    database, so a lost response cannot count a download twice.
    """
    global _last_remote_error, _last_remote_success
    last_error: Exception | None = None

    for attempt in range(_REMOTE_ATTEMPTS):
        try:
            result = callback(_get_supabase())
        except (SchemaOutdatedError, DuplicateUserError):
            raise
        except Exception as exc:
            if _is_unique_violation(exc):
                raise DuplicateUserError(
                    _duplicate_field(getattr(exc, "message", None), getattr(exc, "details", None))
                ) from exc
            last_error = exc
            _last_remote_error = f"{operation}: {_describe_error(exc)}"
            if _is_schema_error(exc):
                _invalidate_schema_cache()
                raise SchemaOutdatedError(_describe_error(exc)) from exc
            retry = _is_transient(exc) if idempotent else _never_reached_database(exc)
            if not retry or attempt == _REMOTE_ATTEMPTS - 1:
                break
            time.sleep(0.25 * (2 ** attempt))
            continue
        _last_remote_error = None
        _last_remote_success = _now_iso()
        return result

    raise StorageUnavailableError(
        f"Persistent storage is temporarily unavailable during {operation}."
    ) from last_error


def _content_range_total(header: str | None) -> int:
    """Row total from PostgREST's Content-Range header ("0-24/310", "*/12")."""
    if not header:
        return 0
    span, _, total = header.partition("/")
    if total.strip().isdigit():
        return int(total)
    first, _, last = span.partition("-")
    if first.strip().isdigit() and last.strip().isdigit():
        return int(last) - int(first) + 1
    return 0


def _execute_for_count(builder: Any) -> int:
    """Run a mutation with Prefer: count=exact, return=minimal; return its count.

    postgrest-py 0.16 drops the count when the body is empty (return=minimal),
    so the request is sent through the builder's own session and the
    Content-Range header is read directly. No rows travel back.
    """
    response = builder.session.request(
        builder.http_method,
        builder.path,
        json=builder.json,
        params=builder.params,
        headers=builder.headers,
    )
    if not response.is_success:
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            payload = generate_default_error_message(response)
        raise APIError(payload)
    return _content_range_total(response.headers.get("content-range"))


def _remote_count(client: Client, table: str, apply_filters: Callable[[Any], Any] | None = None) -> int:
    query = client.table(table).select("id", count="exact")
    if apply_filters is not None:
        query = apply_filters(query)
    return int(query.limit(1).execute().count or 0)


def _order(query: Any, column: str, desc: bool) -> Any:
    # Explicit nullslast: Postgres sorts NULLs first on DESC, which would put
    # never-logged-in accounts above recent ones.
    return query.order(f"{column}.{'desc' if desc else 'asc'}.nullslast")


def _add_logic_groups(query: Any, groups: list[str]) -> Any:
    """AND together several or=(...) groups as one and=(or(...),or(...))."""
    if len(groups) == 1:
        return query.or_(groups[0])
    if groups:
        query.params = query.params.add("and", "(" + ",".join(f"or({g})" for g in groups) + ")")
    return query


def _remote_page(
    client: Client,
    table: str,
    columns: str,
    apply_filters: Callable[[Any], Any],
    apply_order: Callable[[Any], Any],
    offset: int,
    limit: int,
) -> tuple[list[dict], int]:
    """Rows for one page plus the total number of matching rows."""
    if offset == 0:
        query = apply_order(apply_filters(client.table(table).select(columns, count="exact")))
        response = query.range(0, limit - 1).execute()
        return list(response.data or []), int(response.count or 0)

    # With count=exact, an offset past the end is a 416 error, and PostgREST
    # 13/14 send that 416 with a truncated body that leaves junk on the
    # keep-alive connection. Without count it is simply an empty page.
    query = apply_order(apply_filters(client.table(table).select(columns)))
    rows = list(query.range(offset, offset + limit - 1).execute().data or [])
    if 0 < len(rows) < limit:
        return rows, offset + len(rows)  # the last page reveals the total
    return rows, _remote_count(client, table, apply_filters)


def _invalidate_schema_cache() -> None:
    global _schema_cache
    with _cache_lock:
        _schema_cache = None


def _clear_caches() -> None:
    """Forget cached schema and settings (tests switch backends at runtime)."""
    global _schema_cache
    with _cache_lock:
        _schema_cache = None
        _settings_cache.clear()


def _probe_remote_schema(client: Client) -> list[str]:
    """Names of v2 tables, columns and functions that Supabase lacks."""
    missing: list[str] = []

    def probe(run: Callable[[], Any]) -> bool:
        try:
            run()
            return True
        except APIError as exc:
            if not _is_schema_error(exc):
                raise
            return False

    for table, columns in (("users", _USER_V2_COLUMNS), ("download_logs", _LOG_V2_COLUMNS)):
        if probe(lambda: client.table(table).select(",".join(columns)).limit(1).execute()):
            continue
        if not probe(lambda: client.table(table).select("id").limit(1).execute()):
            missing.append(table)
            continue
        # One cheap request per column, only while the schema is outdated, so
        # the admin sees exactly what is missing.
        for column in columns:
            if not probe(lambda: client.table(table).select(column).limit(1).execute()):
                missing.append(f"{table}.{column}")

    if not probe(lambda: client.table("app_settings").select("key,value").limit(1).execute()):
        missing.append("app_settings")
    # Side-effect free calls: no row has the nil UUID, and no log is that new.
    if not probe(lambda: client.rpc(
        "record_user_download",
        {"p_user_id": "00000000-0000-0000-0000-000000000000", "p_today": "2000-01-01"},
    ).execute()):
        missing.append("record_user_download()")
    if not probe(lambda: client.rpc(
        "download_stats",
        {"p_since": "9999-01-01T00:00:00+00:00", "p_tz": "UTC"},
    ).execute()):
        missing.append("download_stats()")
    return missing


# ── SQLite plumbing ──────────────────────────────────────────────────────

_LOCAL_SCHEMA_VERSION = 2
_LOCAL_TS_SQL = "strftime('%Y-%m-%dT%H:%M:%f+00:00', {column})"
_LOCAL_TS_GLOB = (
    "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T"
    "[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+00:00"
)

_LOCAL_TABLES = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('approved', 'pending', 'blocked')),
        name TEXT,
        note TEXT,
        email TEXT,
        phone TEXT,
        password_hash TEXT,
        temp_password INTEGER NOT NULL DEFAULT 0,
        daily_limit INTEGER,
        downloads_today INTEGER NOT NULL DEFAULT 0,
        usage_date TEXT,
        total_downloads INTEGER NOT NULL DEFAULT 0,
        approved_at TEXT,
        credentials_sent_at TEXT,
        last_login_at TEXT,
        last_download_at TEXT,
        created_at TEXT,
        updated_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS download_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        identifier TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        platform TEXT,
        quality TEXT,
        file_size INTEGER,
        created_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT
    )
    """,
)

# Columns that v1 local databases may lack; ALTER TABLE adds them in place.
_LOCAL_COLUMNS = {
    "users": (
        ("name", "TEXT"),
        ("note", "TEXT"),
        ("email", "TEXT"),
        ("phone", "TEXT"),
        ("password_hash", "TEXT"),
        ("temp_password", "INTEGER NOT NULL DEFAULT 0"),
        ("daily_limit", "INTEGER"),
        ("downloads_today", "INTEGER NOT NULL DEFAULT 0"),
        ("usage_date", "TEXT"),
        ("total_downloads", "INTEGER NOT NULL DEFAULT 0"),
        ("approved_at", "TEXT"),
        ("credentials_sent_at", "TEXT"),
        ("last_login_at", "TEXT"),
        ("last_download_at", "TEXT"),
        ("created_at", "TEXT"),
        ("updated_at", "TEXT"),
    ),
    "download_logs": (
        ("user_id", "INTEGER"),
        ("title", "TEXT"),
        ("platform", "TEXT"),
        ("quality", "TEXT"),
        ("file_size", "INTEGER"),
        ("created_at", "TEXT"),
    ),
}

_LOCAL_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_users_status ON users (status)",
    "CREATE INDEX IF NOT EXISTS idx_logs_created ON download_logs (created_at)",
    "CREATE INDEX IF NOT EXISTS idx_logs_user ON download_logs (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_logs_platform ON download_logs (platform)",
)
_LOCAL_UNIQUE_INDEXES = (
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email)",
    "CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON users (phone)",
)


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    for table, columns in _LOCAL_COLUMNS.items():
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for column, declaration in columns:
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")


def _backfill_local(conn: sqlite3.Connection) -> None:
    """Bring v1 rows up to v2 (mirrors the backfills in migration_v2.sql)."""
    now = _db_ts(_utcnow())

    # v1 stored CURRENT_TIMESTAMP ("2026-07-15 18:31:33"); v2 compares
    # fixed-width ISO strings, so every stored timestamp must share one format.
    for table, columns in (
        ("users", _USER_TIMESTAMP_FIELDS),
        ("download_logs", ("created_at",)),
    ):
        for column in columns:
            converted = _LOCAL_TS_SQL.format(column=column)
            conn.execute(
                f"UPDATE {table} SET {column} = {converted} "
                f"WHERE {column} IS NOT NULL AND {column} NOT GLOB ? AND {converted} IS NOT NULL",
                (_LOCAL_TS_GLOB,),
            )
        conn.execute(f"UPDATE {table} SET created_at = ? WHERE created_at IS NULL", (now,))

    conn.execute(
        "UPDATE users SET approved_at = COALESCE(updated_at, created_at, ?) "
        "WHERE status = 'approved' AND approved_at IS NULL",
        (now,),
    )

    # Several v1 identifiers can map to one address or number; approved and
    # then older accounts win, and nobody takes a value another row owns.
    candidates = conn.execute(
        "SELECT id, identifier, email, phone FROM users "
        "WHERE email IS NULL OR phone IS NULL "
        "ORDER BY (status = 'approved') DESC, created_at, id"
    ).fetchall()
    for row in candidates:
        identifier = row["identifier"] or ""
        if row["email"] is None and "@" in identifier:
            email = identifier.strip().lower()
            if not conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, row["id"]))
        phone = _legacy_phone(identifier) if row["phone"] is None else None
        if phone and not conn.execute("SELECT 1 FROM users WHERE phone = ?", (phone,)).fetchone():
            conn.execute("UPDATE users SET phone = ? WHERE id = ?", (phone, row["id"]))

    # Lifetime totals from the audit log; untitled v1 rows were duplicates.
    conn.execute(
        """
        UPDATE users SET
            total_downloads = (
                SELECT COUNT(*) FROM download_logs AS l
                WHERE l.identifier = users.identifier AND COALESCE(l.title, '') <> ''
            ),
            last_download_at = (
                SELECT MAX(l.created_at) FROM download_logs AS l
                WHERE l.identifier = users.identifier
            )
        WHERE last_download_at IS NULL AND total_downloads = 0
          AND EXISTS (SELECT 1 FROM download_logs AS l WHERE l.identifier = users.identifier)
        """
    )
    conn.execute(
        """
        UPDATE download_logs SET user_id = (
            SELECT u.id FROM users AS u WHERE u.identifier = download_logs.identifier
        )
        WHERE user_id IS NULL
          AND EXISTS (SELECT 1 FROM users AS u WHERE u.identifier = download_logs.identifier)
        """
    )

    placeholders = ",".join("?" for _ in PLATFORM_LABELS)
    legacy_logs = conn.execute(
        f"SELECT id, platform, url FROM download_logs "
        f"WHERE platform IS NULL OR platform NOT IN ({placeholders})",
        PLATFORM_LABELS,
    ).fetchall()
    for row in legacy_logs:
        label = _legacy_platform_label(row["platform"], row["url"])
        if label:
            conn.execute("UPDATE download_logs SET platform = ? WHERE id = ?", (label, row["id"]))


def _migrate_local(conn: sqlite3.Connection) -> None:
    """Create or upgrade the local schema in one transaction; keeps all rows."""
    with _local_lock:
        try:
            for statement in _LOCAL_TABLES:
                conn.execute(statement)
            _add_missing_columns(conn)
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version < _LOCAL_SCHEMA_VERSION:
                _backfill_local(conn)
            for statement in _LOCAL_INDEXES:
                conn.execute(statement)
            for statement in _LOCAL_UNIQUE_INDEXES:
                try:
                    conn.execute(statement)
                except sqlite3.IntegrityError as exc:
                    # Hand-edited local data; create_user/update_user still
                    # check for duplicates before writing.
                    logger.warning("Local database keeps duplicate logins: %s", exc)
            now = _db_ts(_utcnow())
            conn.executemany(
                "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
                [(key, value, now) for key, value in DEFAULT_SETTINGS.items()],
            )
            if version < _LOCAL_SCHEMA_VERSION:
                conn.execute(f"PRAGMA user_version = {_LOCAL_SCHEMA_VERSION}")
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def _open_conn(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        _migrate_local(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def _get_local_conn() -> sqlite3.Connection:
    global _local_conn, LOCAL_DB_PATH, _local_db_error
    if _local_conn is not None:
        return _local_conn

    with _local_lock:
        if _local_conn is not None:
            return _local_conn
        try:
            _local_conn = _open_conn(LOCAL_DB_PATH)
            _local_db_error = None
        except Exception as exc:
            _local_db_error = f"{type(exc).__name__}: {exc}"
            fallback = Path(tempfile.gettempdir()) / "unistream_fallback.sqlite3"
            if fallback == LOCAL_DB_PATH:
                raise
            LOCAL_DB_PATH = fallback
            _local_conn = _open_conn(LOCAL_DB_PATH)
    return _local_conn


def _local_rows(sql: str, params: tuple | list = ()) -> list[sqlite3.Row]:
    conn = _get_local_conn()
    with _local_lock:
        return conn.execute(sql, params).fetchall()


@contextmanager
def _local_transaction() -> Iterator[sqlite3.Connection]:
    conn = _get_local_conn()
    with _local_lock:
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def _local_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return _db_ts(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return int(value)
    return value


def _remote_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return _remote_ts(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


# ── Schema status and migration script ───────────────────────────────────


def schema_status(refresh: bool = False) -> dict:
    """Whether the v2 schema is in place: {"ready", "missing", "checked_at"}.

    SQLite migrates itself on open, so it is always ready. Supabase is probed
    with a few cheap requests; a ready result is cached for an hour and an
    outdated one for 30 s (any SchemaOutdatedError also clears the cache).
    """
    global _schema_cache
    if not SUPABASE_CONFIGURED:
        return {"ready": True, "missing": [], "checked_at": _now_iso()}

    with _cache_lock:
        cached = _schema_cache
        if not refresh and cached is not None and cached["expires"] > time.monotonic():
            status = cached["status"]
            return {**status, "missing": list(status["missing"])}

    missing = _remote("schema check", _probe_remote_schema)
    status = {"ready": not missing, "missing": missing, "checked_at": _now_iso()}
    ttl = _SCHEMA_OUTDATED_TTL_SECONDS if missing else _SCHEMA_READY_TTL_SECONDS
    with _cache_lock:
        _schema_cache = {"status": status, "expires": time.monotonic() + ttl}
    return {**status, "missing": list(missing)}


def migration_sql() -> str:
    """The Supabase upgrade script, shown in the admin panel."""
    for path in (MIGRATION_SQL_PATH, _ROOT_MIGRATION_SQL_PATH):
        try:
            return path.read_text(encoding="utf-8")
        except OSError:
            continue
    return "-- supabase_migration_v2.sql was not found next to the backend.\n"


# ── Users ────────────────────────────────────────────────────────────────


def get_user_by_id(user_id: str) -> dict | None:
    if SUPABASE_CONFIGURED:
        remote_id = _uuid_or_none(user_id)
        if remote_id is None:
            return None

        def operation(client: Client):
            rows = (
                client.table("users").select(_USER_SELECT)
                .eq("id", remote_id).limit(1).execute().data
            )
            return rows[0] if rows else None

        return _user_from_row(_remote("get user", operation))

    local_id = _local_id_or_none(user_id)
    if local_id is None:
        return None
    rows = _local_rows("SELECT * FROM users WHERE id = ?", (local_id,))
    return _user_from_row(rows[0]) if rows else None


def get_user_by_login(login: str) -> dict | None:
    """Account whose email, phone or legacy identifier equals ``login``.

    ``login`` is already normalised by the caller (lowercase email or E.164
    phone); emails are lowercased again defensively.
    """
    value = (login or "").strip()
    if "@" in value:
        value = value.lower()
    if not value:
        return None

    if SUPABASE_CONFIGURED:
        quoted = _postgrest_quote(value)

        def operation(client: Client):
            return (
                client.table("users").select(_USER_SELECT)
                .or_(f"email.eq.{quoted},phone.eq.{quoted},identifier.eq.{quoted}")
                .limit(3).execute().data
            )

        rows = _remote("get user", operation) or []
    else:
        rows = [
            dict(row)
            for row in _local_rows(
                "SELECT * FROM users WHERE email = ? OR phone = ? OR identifier = ? LIMIT 3",
                (value, value, value),
            )
        ]

    # Prefer the account that owns the value as its email, then its phone.
    for column in ("email", "phone", "identifier"):
        for row in rows:
            if row.get(column) == value:
                return _user_from_row(row)
    return None


def get_user(identifier: str) -> dict | None:
    """Legacy alias of get_user_by_login for v1 callers."""
    return get_user_by_login(normalize(identifier))


def _local_conflict(conn: sqlite3.Connection, email: str | None, phone: str | None, exclude: int | None) -> str | None:
    for field, value in (("email", email), ("phone", phone)):
        if not value:
            continue
        row = conn.execute(
            f"SELECT 1 FROM users WHERE ({field} = ? OR identifier = ?) "
            "AND (? IS NULL OR id <> ?) LIMIT 1",
            (value, value, exclude, exclude),
        ).fetchone()
        if row:
            return field
    return None


def find_conflicts(email: str | None, phone: str | None, exclude_id: str | None = None) -> str | None:
    """"email" or "phone" when another account already uses that value."""
    email = _clean_email(email)
    phone = _clean_text(phone)

    if not SUPABASE_CONFIGURED:
        conn = _get_local_conn()
        with _local_lock:
            return _local_conflict(conn, email, phone, _local_id_or_none(exclude_id))

    exclude = _uuid_or_none(exclude_id) if exclude_id is not None else None

    def operation(client: Client):
        for field, value in (("email", email), ("phone", phone)):
            if not value:
                continue
            quoted = _postgrest_quote(value)
            query = client.table("users").select("id").or_(
                f"{field}.eq.{quoted},identifier.eq.{quoted}"
            )
            if exclude:
                query = query.neq("id", exclude)
            if query.limit(1).execute().data:
                return field
        return None

    return _remote("check duplicate account", operation)


def create_user(
    *,
    name: str,
    email: str,
    phone: str,
    note: str | None = None,
    status: str = "pending",
    daily_limit: int | None = None,
) -> dict:
    """Create an account whose login identifier is its email.

    Accounts created as approved get approved_at now. Raises
    DuplicateUserError when the email or phone is taken.
    """
    status = _check_status(status)
    daily_limit = _check_daily_limit(daily_limit)
    email = _clean_email(email)
    phone = _clean_text(phone)
    name = _clean_text(name)
    note = _clean_text(note)
    if not email:
        raise ValueError("email is required.")
    now = _utcnow()
    approved_at = now if status == "approved" else None

    if SUPABASE_CONFIGURED:
        conflict = find_conflicts(email, phone)
        if conflict:
            raise DuplicateUserError(conflict)
        payload = {
            "identifier": email,
            "status": status,
            "name": name,
            "note": note,
            "email": email,
            "phone": phone,
            "daily_limit": daily_limit,
            "temp_password": False,
            "approved_at": _remote_value(approved_at),
        }

        def operation(client: Client):
            rows = client.table("users").insert(payload).execute().data
            return rows[0] if rows else None

        row = _remote("create user", operation, idempotent=False)
        user = _user_from_row(row) if row else get_user_by_login(email)
        if user is None:
            raise StorageUnavailableError("The new account could not be read back.")
        return user

    with _local_transaction() as conn:
        conflict = _local_conflict(conn, email, phone, None)
        if conflict:
            raise DuplicateUserError(conflict)
        try:
            cursor = conn.execute(
                """
                INSERT INTO users (
                    identifier, status, name, note, email, phone, daily_limit,
                    temp_password, downloads_today, total_downloads,
                    approved_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
                """,
                (
                    email, status, name, note, email, phone, daily_limit,
                    _local_value(approved_at), _db_ts(now), _db_ts(now),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise DuplicateUserError(_duplicate_field(str(exc))) from exc
        new_id = cursor.lastrowid
    user = get_user_by_id(str(new_id))
    if user is None:
        raise StorageUnavailableError("The new account could not be read back.")
    return user


def update_user(user_id: str, fields: dict) -> dict | None:
    """Apply ``fields`` (see UPDATABLE_USER_FIELDS) and return the account.

    None values are stored as NULL (daily_limit None = default limit).
    Returns None when the account does not exist; raises DuplicateUserError
    for a taken email/phone and ValueError for unknown keys or bad values.
    """
    changes = _prepare_user_changes(fields)

    if SUPABASE_CONFIGURED:
        remote_id = _uuid_or_none(user_id)
        if remote_id is None:
            return None
        if not changes:
            return get_user_by_id(remote_id)
        current = None
        if changes.get("phone") and not changes.get("email"):
            current = get_user_by_id(remote_id)
            if current is None:
                return None
        if changes.get("email") or changes.get("phone"):
            conflict = find_conflicts(changes.get("email"), changes.get("phone"), exclude_id=remote_id)
            if conflict:
                raise DuplicateUserError(conflict)
        payload = {key: _remote_value(value) for key, value in changes.items()}
        identifier = _new_identifier(changes, current)
        if identifier:
            payload["identifier"] = identifier

        def operation(client: Client):
            rows = client.table("users").update(payload).eq("id", remote_id).execute().data
            return rows[0] if rows else None

        return _user_from_row(_remote("update user", operation))

    local_id = _local_id_or_none(user_id)
    if local_id is None:
        return None
    with _local_transaction() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (local_id,)).fetchone()
        if row is None:
            return None
        if changes:
            conflict = _local_conflict(conn, changes.get("email"), changes.get("phone"), local_id)
            if conflict:
                raise DuplicateUserError(conflict)
            values = {key: _local_value(value) for key, value in changes.items()}
            identifier = _new_identifier(changes, dict(row))
            if identifier:
                values["identifier"] = identifier
            values["updated_at"] = _db_ts(_utcnow())
            # Keys come from UPDATABLE_USER_FIELDS, never from the caller's text.
            assignments = ", ".join(f"{key} = ?" for key in values)
            try:
                conn.execute(
                    f"UPDATE users SET {assignments} WHERE id = ?",
                    (*values.values(), local_id),
                )
            except sqlite3.IntegrityError as exc:
                raise DuplicateUserError(_duplicate_field(str(exc))) from exc
        row = conn.execute("SELECT * FROM users WHERE id = ?", (local_id,)).fetchone()
    return _user_from_row(row)


def delete_user(user_id: str) -> bool:
    """Delete an account; its download logs stay, detached (user_id NULL)."""
    if SUPABASE_CONFIGURED:
        remote_id = _uuid_or_none(user_id)
        if remote_id is None:
            return False
        deleted = _remote(
            "delete user",
            lambda client: _execute_for_count(
                client.table("users").delete(count="exact", returning="minimal").eq("id", remote_id)
            ),
        )
        return deleted > 0

    local_id = _local_id_or_none(user_id)
    if local_id is None:
        return False
    with _local_transaction() as conn:
        conn.execute("UPDATE download_logs SET user_id = NULL WHERE user_id = ?", (local_id,))
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (local_id,))
        return cursor.rowcount > 0


def list_users(
    *,
    status: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
    sort: str = "created_at",
    order: str = "desc",
) -> dict:
    """One page of accounts: {"items": [user, ...], "total": int}."""
    if status in ("", "all"):
        status = None
    if status is not None:
        _check_status(status)
    sort = sort if sort in USER_SORTS else "created_at"
    desc = str(order).lower() != "asc"
    page = max(1, int(page))
    page_size = min(max(1, int(page_size)), MAX_USER_PAGE_SIZE)
    offset = (page - 1) * page_size
    term = _clean_search(q)

    if SUPABASE_CONFIGURED:
        def apply_filters(query):
            if status:
                query = query.eq("status", status)
            if term:
                query = query.or_(_postgrest_search(_USER_SEARCH_COLUMNS, term))
            return query

        def apply_order(query):
            query = _order(query, sort, desc)
            if sort != "created_at":
                query = _order(query, "created_at", True)
            return _order(query, "id", True)

        rows, total = _remote(
            "list users",
            lambda client: _remote_page(
                client, "users", _USER_SELECT, apply_filters, apply_order, offset, page_size
            ),
        )
        return {"items": [_user_from_row(row) for row in rows], "total": total}

    where: list[str] = []
    params: list[Any] = []
    if status:
        where.append("status = ?")
        params.append(status)
    if term:
        clause, search_params = _local_search(_USER_SEARCH_COLUMNS, term)
        where.append(clause)
        params.extend(search_params)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    direction = "DESC" if desc else "ASC"
    sort_expr = "name COLLATE NOCASE" if sort == "name" else sort
    order_sql = f"({sort} IS NULL), {sort_expr} {direction}"
    if sort != "created_at":
        order_sql += ", created_at DESC"
    order_sql += ", id DESC"

    conn = _get_local_conn()
    with _local_lock:
        total = conn.execute(f"SELECT COUNT(*) FROM users {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM users {where_sql} ORDER BY {order_sql} LIMIT ? OFFSET ?",
            (*params, page_size, offset),
        ).fetchall()
    return {"items": [_user_from_row(row) for row in rows], "total": int(total)}


def user_status_counts() -> dict:
    """{"total", "pending", "approved", "blocked"} using count queries only."""
    statuses = sorted(VALID_STATUSES)
    if SUPABASE_CONFIGURED:
        def operation(client: Client):
            counts = {
                status: _remote_count(client, "users", lambda q, s=status: q.eq("status", s))
                for status in statuses
            }
            counts["total"] = _remote_count(client, "users")
            return counts

        return _remote("count users", operation)

    rows = _local_rows("SELECT status, COUNT(*) FROM users GROUP BY status")
    counts = {status: 0 for status in statuses}
    total = 0
    for status, count in rows:
        total += count
        if status in counts:
            counts[status] = count
    counts["total"] = total
    return counts


def record_user_download(user_id: str, today: date) -> int:
    """Count one completed download for ``today`` (the app's local date).

    Atomic: the counter restarts at 1 on a new day. Returns the new
    downloads_today, or 0 when the account no longer exists.
    """
    day = _coerce_date(today, "today")
    if day is None:
        raise ValueError("today is required.")

    if SUPABASE_CONFIGURED:
        remote_id = _uuid_or_none(user_id)
        if remote_id is None:
            return 0
        result = _remote(
            "record download",
            lambda client: client.rpc(
                "record_user_download",
                {"p_user_id": remote_id, "p_today": day.isoformat()},
            ).execute().data,
            idempotent=False,
        )
        return _int_or_none(result) or 0

    local_id = _local_id_or_none(user_id)
    if local_id is None:
        return 0
    now = _db_ts(_utcnow())
    with _local_transaction() as conn:
        conn.execute(
            """
            UPDATE users SET
                downloads_today = CASE WHEN usage_date = ? THEN downloads_today + 1 ELSE 1 END,
                usage_date = ?,
                total_downloads = total_downloads + 1,
                last_download_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (day.isoformat(), day.isoformat(), now, now, local_id),
        )
        row = conn.execute("SELECT downloads_today FROM users WHERE id = ?", (local_id,)).fetchone()
    return int(row[0]) if row else 0


# ── Download logs ────────────────────────────────────────────────────────


class _LogFilter(NamedTuple):
    term: str
    platform: str | None
    user_id: Any  # uuid string (Supabase) or int (SQLite)
    date_from: datetime | None
    date_to: datetime | None


def _log_filter(
    q: str | None,
    platform: str | None,
    user_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
) -> _LogFilter | None:
    """Normalised filters, or None when they can match nothing (bad user id)."""
    resolved_user = None
    if user_id not in (None, ""):
        resolved_user = _uuid_or_none(user_id) if SUPABASE_CONFIGURED else _local_id_or_none(user_id)
        if resolved_user is None:
            return None
    return _LogFilter(
        term=_clean_search(q),
        platform=_clean_text(platform),
        user_id=resolved_user,
        date_from=_parse_datetime(date_from) if date_from is not None else None,
        date_to=_parse_datetime(date_to) if date_to is not None else None,
    )


def _apply_remote_log_filters(query: Any, flt: _LogFilter, extra_groups: tuple[str, ...] = ()) -> Any:
    groups = [_postgrest_search(_LOG_SEARCH_COLUMNS, flt.term)] if flt.term else []
    groups.extend(extra_groups)
    if flt.platform:
        # Case-insensitive equality: matches "YouTube" for "youtube" too.
        query = query.ilike("platform", _like_escape(flt.platform).replace("*", "_"))
    if flt.user_id:
        query = query.eq("user_id", flt.user_id)
    if flt.date_from:
        query = query.gte("created_at", _remote_ts(flt.date_from))
    if flt.date_to:
        query = query.lt("created_at", _remote_ts(flt.date_to))
    return _add_logic_groups(query, groups)


def _local_log_where(flt: _LogFilter) -> tuple[list[str], list[Any]]:
    where: list[str] = []
    params: list[Any] = []
    if flt.term:
        clause, search_params = _local_search(_LOG_SEARCH_COLUMNS, flt.term)
        where.append(clause)
        params.extend(search_params)
    if flt.platform:
        where.append("platform = ? COLLATE NOCASE")
        params.append(flt.platform)
    if flt.user_id is not None:
        where.append("user_id = ?")
        params.append(flt.user_id)
    if flt.date_from:
        where.append("created_at >= ?")
        params.append(_db_ts(flt.date_from))
    if flt.date_to:
        where.append("created_at < ?")
        params.append(_db_ts(flt.date_to))
    return where, params


def add_download_log(
    *,
    user_id: str | None,
    identifier: str,
    url: str,
    title: str = "",
    platform: str = "",
    quality: str | None = None,
    file_size: int | None = None,
) -> None:
    """Record one completed download in the audit log."""
    size = _int_or_none(file_size)
    record = {
        "identifier": identifier or "",
        "url": (url or "")[:MAX_LOG_URL_LENGTH],
        "title": (title or "")[:MAX_LOG_TITLE_LENGTH],
        "platform": platform or "",
        "quality": _clean_text(quality),
        "file_size": size if size is not None and size >= 0 else None,
    }

    if SUPABASE_CONFIGURED:
        payload = {**record, "user_id": _uuid_or_none(user_id) if user_id else None}

        def operation(client: Client):
            try:
                client.table("download_logs").insert(payload, returning="minimal").execute()
            except APIError as exc:
                # The account was deleted while its download ran (foreign key
                # violation): keep the audit row, detached like older logs.
                if _error_code(exc) != "23503" or payload["user_id"] is None:
                    raise
                client.table("download_logs").insert(
                    {**payload, "user_id": None}, returning="minimal"
                ).execute()

        _remote("record download log", operation, idempotent=False)
        return

    with _local_transaction() as conn:
        conn.execute(
            """
            INSERT INTO download_logs (
                user_id, identifier, url, title, platform, quality, file_size, created_at
            ) VALUES ((SELECT id FROM users WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                _local_id_or_none(user_id) if user_id else None,
                record["identifier"], record["url"], record["title"], record["platform"],
                record["quality"], record["file_size"], _db_ts(_utcnow()),
            ),
        )


def list_download_logs(
    *,
    q: str | None = None,
    platform: str | None = None,
    user_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict:
    """Newest-first page of logs: {"items", "total"}. date_to is exclusive."""
    page = max(1, int(page))
    page_size = min(max(1, int(page_size)), MAX_LOG_PAGE_SIZE)
    offset = (page - 1) * page_size
    flt = _log_filter(q, platform, user_id, date_from, date_to)
    if flt is None:
        return {"items": [], "total": 0}

    if SUPABASE_CONFIGURED:
        rows, total = _remote(
            "list download logs",
            lambda client: _remote_page(
                client,
                "download_logs",
                _LOG_SELECT,
                lambda query: _apply_remote_log_filters(query, flt),
                lambda query: _order(_order(query, "created_at", True), "id", True),
                offset,
                page_size,
            ),
        )
        return {"items": [_log_from_row(row) for row in rows], "total": total}

    where, params = _local_log_where(flt)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    conn = _get_local_conn()
    with _local_lock:
        total = conn.execute(f"SELECT COUNT(*) FROM download_logs {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM download_logs {where_sql} "
            "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            (*params, page_size, offset),
        ).fetchall()
    return {"items": [_log_from_row(row) for row in rows], "total": int(total)}


def _remote_log_batch(flt: _LogFilter, after: tuple[str, str] | None, size: int) -> list[dict]:
    extra: tuple[str, ...] = ()
    if after is not None:
        created, row_id = (_postgrest_quote(str(value)) for value in after)
        extra = (f"created_at.lt.{created},and(created_at.eq.{created},id.lt.{row_id})",)

    def operation(client: Client):
        query = _apply_remote_log_filters(client.table("download_logs").select(_LOG_SELECT), flt, extra)
        query = _order(_order(query, "created_at", True), "id", True)
        return list(query.limit(size).execute().data or [])

    return _remote("export download logs", operation)


def _local_log_batch(flt: _LogFilter, after: tuple[str, int] | None, size: int) -> list[dict]:
    where, params = _local_log_where(flt)
    if after is not None:
        where.append("(created_at < ? OR (created_at = ? AND id < ?))")
        params.extend([after[0], after[0], after[1]])
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    rows = _local_rows(
        f"SELECT * FROM download_logs {where_sql} ORDER BY created_at DESC, id DESC LIMIT ?",
        (*params, size),
    )
    return [dict(row) for row in rows]


def _log_batch(flt: _LogFilter, after: tuple | None, size: int) -> list[dict]:
    if SUPABASE_CONFIGURED:
        return _remote_log_batch(flt, after, size)
    return _local_log_batch(flt, after, size)


def _continue_logs(flt: _LogFilter, rows: list[dict], remaining: int) -> Iterator[dict]:
    while True:
        for row in rows:
            yield _log_from_row(row)
        size = min(REMOTE_PAGE_SIZE, remaining)
        remaining -= len(rows)
        if len(rows) < size or remaining <= 0:
            return
        after = (rows[-1]["created_at"], rows[-1]["id"])
        rows = _log_batch(flt, after, min(REMOTE_PAGE_SIZE, remaining))


def iter_download_logs(
    *,
    q: str | None = None,
    platform: str | None = None,
    user_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 50000,
) -> Iterator[dict]:
    """Matching logs newest first (for CSV export), at most ``limit``.

    The first batch is read before this returns, so storage errors surface
    while the caller can still answer with an error status instead of a
    half-written file. Later batches follow a (created_at, id) cursor rather
    than offsets, so downloads completing mid-export neither repeat nor skip.
    """
    flt = _log_filter(q, platform, user_id, date_from, date_to)
    remaining = max(0, int(limit))
    if flt is None or remaining == 0:
        return iter(())
    first = _log_batch(flt, None, min(REMOTE_PAGE_SIZE, remaining))
    return _continue_logs(flt, first, remaining)


def delete_download_logs(ids: list[str]) -> int:
    """Delete logs by id; returns how many existed."""
    if SUPABASE_CONFIGURED:
        valid = sorted({value for value in map(_uuid_or_none, ids or []) if value})
        deleted = 0
        # ~100 UUIDs keep the request URL far below proxy limits.
        for start in range(0, len(valid), 100):
            chunk = valid[start:start + 100]
            deleted += _remote(
                "delete download logs",
                lambda client, chunk=chunk: _execute_for_count(
                    client.table("download_logs")
                    .delete(count="exact", returning="minimal")
                    .in_("id", chunk)
                ),
            )
        return deleted

    valid_local = sorted({value for value in map(_local_id_or_none, ids or []) if value is not None})
    deleted = 0
    with _local_transaction() as conn:
        for start in range(0, len(valid_local), 500):
            chunk = valid_local[start:start + 500]
            placeholders = ",".join("?" for _ in chunk)
            cursor = conn.execute(f"DELETE FROM download_logs WHERE id IN ({placeholders})", chunk)
            deleted += cursor.rowcount
    return deleted


def purge_download_logs(*, before: datetime | None) -> int:
    """Delete logs created before ``before`` (None = every log); returns the count."""
    cutoff = _parse_datetime(before) if before is not None else None
    if before is not None and cutoff is None:
        raise ValueError("before must be a datetime.")

    if SUPABASE_CONFIGURED:
        def operation(client: Client):
            query = client.table("download_logs").delete(count="exact", returning="minimal")
            if cutoff is not None:
                query = query.lt("created_at", _remote_ts(cutoff))
            else:
                # Supabase rejects DELETE without a WHERE clause (safeupdate).
                query = query.not_.is_("id", "null")
            return _execute_for_count(query)

        return _remote("purge download logs", operation)

    with _local_transaction() as conn:
        if cutoff is not None:
            cursor = conn.execute("DELETE FROM download_logs WHERE created_at < ?", (_db_ts(cutoff),))
        else:
            cursor = conn.execute("DELETE FROM download_logs")
        return cursor.rowcount


def count_download_logs() -> int:
    if SUPABASE_CONFIGURED:
        return _remote("count download logs", lambda client: _remote_count(client, "download_logs"))
    return int(_local_rows("SELECT COUNT(*) FROM download_logs")[0][0])


def download_stats(*, since: datetime, tz: str) -> list[dict]:
    """Downloads per local day and platform since ``since``.

    Returns [{"day": "YYYY-MM-DD", "platform": str, "downloads": int}] sorted
    by day, then platform. Days are calendar days in ``tz``.
    """
    start = _parse_datetime(since)
    if start is None:
        raise ValueError("since must be a datetime.")

    if SUPABASE_CONFIGURED:
        def operation(client: Client):
            rows: list[dict] = []
            while True:
                page = client.rpc(
                    "download_stats", {"p_since": _remote_ts(start), "p_tz": tz}
                ).range(len(rows), len(rows) + REMOTE_PAGE_SIZE - 1).execute().data or []
                rows.extend(page)
                if len(page) < REMOTE_PAGE_SIZE:
                    return rows

        rows = _remote("download statistics", operation)
        return [
            {
                "day": _date_text(row.get("day")),
                "platform": row.get("platform") or "",
                "downloads": int(row.get("downloads") or 0),
            }
            for row in rows
        ]

    zone = _zone(tz)
    counts: Counter = Counter()
    rows = _local_rows(
        "SELECT created_at, platform FROM download_logs WHERE created_at >= ?",
        (_db_ts(start),),
    )
    for created_at, platform in rows:
        moment = _parse_datetime(created_at)
        if moment is not None:
            counts[(moment.astimezone(zone).date().isoformat(), platform or "")] += 1
    return [
        {"day": day, "platform": platform, "downloads": downloads}
        for (day, platform), downloads in sorted(counts.items())
    ]


# ── Settings ─────────────────────────────────────────────────────────────


def get_setting(key: str, default: str | None = None) -> str | None:
    """A runtime setting (e.g. default_daily_limit), or ``default``.

    Supabase values are cached for 30 s because quota checks read them on
    every request; set_setting() refreshes this process immediately.
    """
    if SUPABASE_CONFIGURED:
        now = time.monotonic()
        with _cache_lock:
            cached = _settings_cache.get(key)
        if cached is not None and cached[1] > now:
            value = cached[0]
        else:
            def operation(client: Client):
                rows = (
                    client.table("app_settings").select("value")
                    .eq("key", key).limit(1).execute().data
                )
                return rows[0]["value"] if rows else None

            value = _remote("read setting", operation)
            with _cache_lock:
                _settings_cache[key] = (value, now + _SETTINGS_TTL_SECONDS)
        return value if value is not None else default

    rows = _local_rows("SELECT value FROM app_settings WHERE key = ?", (key,))
    return rows[0]["value"] if rows else default


def set_setting(key: str, value: str) -> None:
    set_settings({key: value})


def set_settings(values: dict[str, str]) -> None:
    """Save several settings at once: all of them or none (one upsert request
    on Supabase, one transaction on SQLite), e.g. the admin username together
    with its password hash."""
    values = {str(key): str(value) for key, value in values.items()}
    if not values:
        return
    if SUPABASE_CONFIGURED:
        now = _now_iso()
        payload = [{"key": key, "value": value, "updated_at": now} for key, value in values.items()]
        _remote(
            "save settings",
            lambda client: client.table("app_settings")
            .upsert(payload, on_conflict="key", returning="minimal").execute(),
        )
        expires = time.monotonic() + _SETTINGS_TTL_SECONDS
        with _cache_lock:
            for key, value in values.items():
                _settings_cache[key] = (value, expires)
        return

    now = _db_ts(_utcnow())
    with _local_transaction() as conn:
        conn.executemany(
            """
            INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            [(key, value, now) for key, value in values.items()],
        )


# ── Diagnostics ──────────────────────────────────────────────────────────


def _diagnostic_schema() -> dict:
    try:
        return schema_status()
    except StorageUnavailableError as exc:
        return {"ready": False, "missing": [], "checked_at": _now_iso(), "error": str(exc)}


def storage_diagnostics() -> dict:
    info = {
        "active_backend": "supabase" if SUPABASE_CONFIGURED else "sqlite",
        "persistent": SUPABASE_CONFIGURED,
        "storage_backend_setting": STORAGE_BACKEND,
        "supabase_url_configured": bool(SUPABASE_URL),
        "supabase_key_configured": bool(SUPABASE_KEY),
        "last_remote_success": _last_remote_success,
        "last_remote_error": _last_remote_error,
        "configuration_warning": None,
    }

    if bool(SUPABASE_URL) != bool(SUPABASE_KEY):
        info["configuration_warning"] = (
            "Supabase configuration is incomplete; both URL and service key are required."
        )

    if not SUPABASE_CONFIGURED:
        info.update({
            "seed_db_path": str(SEED_DB_PATH),
            "active_db_path": str(LOCAL_DB_PATH),
            "app_dir_writable": _dir_is_writable(SEED_DB_PATH.parent),
            "first_open_error": _local_db_error,
        })

    try:
        counts = user_status_counts()
        info["reachable"] = True
        info["user_count"] = counts["total"]
        info["status_counts"] = {status: counts[status] for status in sorted(VALID_STATUSES)}
        info["download_log_count"] = count_download_logs()
        info["error"] = None
    except Exception as exc:
        info["reachable"] = False
        info["user_count"] = None
        info["status_counts"] = None
        info["download_log_count"] = None
        info["error"] = f"{type(exc).__name__}: {exc}"

    info["schema"] = _diagnostic_schema()
    # Refresh after the checks above so the report reflects them.
    info["last_remote_success"] = _last_remote_success
    info["last_remote_error"] = _last_remote_error
    return info
