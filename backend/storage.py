"""Persistent storage for access control and completed-download auditing.

Supabase is the single source of truth whenever its credentials are present.
The service must never silently switch to SQLite after a transient remote
failure: doing so creates two conflicting user lists and makes approvals appear
to revert after a restart. SQLite remains an explicit local-development mode.
"""

import asyncio
import os
import shutil
import sqlite3
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, TypeVar

from dotenv import load_dotenv
from supabase import Client, create_client


backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
SUPABASE_CONFIGURED = bool(SUPABASE_URL and SUPABASE_KEY)
VALID_STATUSES = {"approved", "pending", "blocked"}

# The committed database is used only when Supabase is not configured. On a
# read-only checkout, a writable copy is created in the process temp folder.
SEED_DB_PATH = backend_dir / "unistream_local.sqlite3"


class StorageUnavailableError(RuntimeError):
    """The configured persistent store could not complete an operation."""


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

T = TypeVar("T")


def normalize(identifier: str) -> str:
    return identifier.strip().lower()


def _create_schema(conn: sqlite3.Connection) -> None:
    with _local_lock:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                identifier TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending',
                name TEXT,
                note TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS download_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                identifier TEXT NOT NULL,
                url TEXT NOT NULL,
                title TEXT,
                platform TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


def _open_conn(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    _create_schema(conn)
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


def _row_to_dict(row) -> dict:
    return dict(row) if row is not None else {}


def _get_supabase() -> Client:
    global _supabase
    if not SUPABASE_CONFIGURED:
        raise StorageUnavailableError("Supabase is not configured.")

    if _supabase is None:
        with _remote_lock:
            if _supabase is None:
                _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase


def _remote(operation: str, callback: Callable[[Client], T]) -> T:
    """Run a Supabase operation with retries, without changing storage mode."""
    global _last_remote_error, _last_remote_success
    last_error: Exception | None = None

    for attempt in range(3):
        try:
            result = callback(_get_supabase())
            _last_remote_error = None
            _last_remote_success = datetime.now(timezone.utc).isoformat()
            return result
        except Exception as exc:
            last_error = exc
            _last_remote_error = f"{operation}: {type(exc).__name__}: {exc}"
            if attempt < 2:
                time.sleep(0.25 * (2 ** attempt))

    raise StorageUnavailableError(
        f"Persistent storage is temporarily unavailable during {operation}."
    ) from last_error


def _local_get_user(identifier: str):
    conn = _get_local_conn()
    with _local_lock:
        row = conn.execute(
            "SELECT * FROM users WHERE identifier = ?",
            (normalize(identifier),),
        ).fetchone()
    return _row_to_dict(row) if row else None


def _remote_get_user(identifier: str):
    normalized = normalize(identifier)

    def operation(client: Client):
        response = (
            client.table("users")
            .select("*")
            .eq("identifier", normalized)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    return _remote("get user", operation)


def get_user(identifier: str):
    if SUPABASE_CONFIGURED:
        return _remote_get_user(identifier)
    return _local_get_user(identifier)


def upsert_pending_user(identifier: str):
    """Create a pending request without ever changing an existing status."""
    normalized = normalize(identifier)

    if not SUPABASE_CONFIGURED:
        conn = _get_local_conn()
        with _local_lock:
            conn.execute(
                "INSERT OR IGNORE INTO users (identifier, status) VALUES (?, 'pending')",
                (normalized,),
            )
            conn.commit()
        return _local_get_user(normalized)

    def operation(client: Client):
        existing = (
            client.table("users")
            .select("*")
            .eq("identifier", normalized)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]

        try:
            inserted = client.table("users").insert({
                "identifier": normalized,
                "status": "pending",
            }).execute()
            return inserted.data[0] if inserted.data else {"identifier": normalized, "status": "pending"}
        except Exception:
            # A concurrent first-login request may have won the unique insert.
            existing = (
                client.table("users")
                .select("*")
                .eq("identifier", normalized)
                .limit(1)
                .execute()
            )
            if existing.data:
                return existing.data[0]
            raise

    return _remote("create pending user", operation)


def _local_list_users(status: str | None = None):
    conn = _get_local_conn()
    query = "SELECT * FROM users"
    params: tuple = ()
    if status:
        query += " WHERE status = ?"
        params = (status,)
    query += " ORDER BY created_at DESC"
    with _local_lock:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(row) for row in rows]


def list_users(status: str | None = None):
    if not SUPABASE_CONFIGURED:
        return _local_list_users(status)

    def operation(client: Client):
        query = client.table("users").select("*").order("created_at", desc=True)
        if status:
            query = query.eq("status", status)
        return query.execute().data

    return _remote("list users", operation)


def upsert_user(
    identifier: str,
    status: str,
    note: str | None = None,
    name: str | None = None,
):
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid user status: {status}")

    normalized = normalize(identifier)
    if not SUPABASE_CONFIGURED:
        conn = _get_local_conn()
        with _local_lock:
            existing = conn.execute(
                "SELECT id FROM users WHERE identifier = ?",
                (normalized,),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE users
                    SET status = ?, note = COALESCE(?, note),
                        name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP
                    WHERE identifier = ?
                    """,
                    (status, note, name, normalized),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO users (identifier, status, note, name)
                    VALUES (?, ?, ?, ?)
                    """,
                    (normalized, status, note, name),
                )
            conn.commit()
        return _local_get_user(normalized)

    def operation(client: Client):
        existing = (
            client.table("users")
            .select("id")
            .eq("identifier", normalized)
            .limit(1)
            .execute()
        )
        payload = {"status": status}
        if note is not None:
            payload["note"] = note
        if name is not None:
            payload["name"] = name

        if existing.data:
            response = (
                client.table("users")
                .update(payload)
                .eq("identifier", normalized)
                .execute()
            )
        else:
            payload["identifier"] = normalized
            response = client.table("users").insert(payload).execute()
        return response.data[0] if response.data else None

    return _remote("upsert user", operation)


def update_user_status(identifier: str, status: str):
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid user status: {status}")

    normalized = normalize(identifier)
    if not SUPABASE_CONFIGURED:
        conn = _get_local_conn()
        with _local_lock:
            cursor = conn.execute(
                """
                UPDATE users
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE identifier = ?
                """,
                (status, normalized),
            )
            conn.commit()
        return _local_get_user(normalized) if cursor.rowcount else None

    def operation(client: Client):
        response = (
            client.table("users")
            .update({"status": status})
            .eq("identifier", normalized)
            .execute()
        )
        return response.data[0] if response.data else None

    return _remote("update user status", operation)


def delete_user(identifier: str):
    normalized = normalize(identifier)
    if not SUPABASE_CONFIGURED:
        conn = _get_local_conn()
        with _local_lock:
            conn.execute("DELETE FROM users WHERE identifier = ?", (normalized,))
            conn.commit()
        return

    _remote(
        "delete user",
        lambda client: client.table("users").delete().eq("identifier", normalized).execute(),
    )


def record_download(identifier: str, url: str, title: str = "", platform: str = "") -> None:
    normalized = normalize(identifier)
    payload = {
        "identifier": normalized,
        "url": url,
        "title": title,
        "platform": platform,
    }

    if not SUPABASE_CONFIGURED:
        conn = _get_local_conn()
        with _local_lock:
            conn.execute(
                """
                INSERT INTO download_logs (identifier, url, title, platform)
                VALUES (?, ?, ?, ?)
                """,
                (normalized, url, title, platform),
            )
            conn.commit()
        return

    _remote(
        "record download",
        lambda client: client.table("download_logs").insert(payload).execute(),
    )


async def log_download(identifier: str, url: str, title: str = "", platform: str = "") -> None:
    await asyncio.to_thread(record_download, identifier, url, title, platform)


def _local_list_download_logs(limit: int = 50):
    conn = _get_local_conn()
    with _local_lock:
        rows = conn.execute(
            "SELECT * FROM download_logs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def list_download_logs(limit: int = 50):
    limit = max(1, min(int(limit), 1000))
    if not SUPABASE_CONFIGURED:
        return _local_list_download_logs(limit)

    def operation(client: Client):
        return (
            client.table("download_logs")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
        )

    return _remote("list download logs", operation)


def set_user_status(identifier: str, status: str):
    return update_user_status(identifier, status)


def storage_diagnostics() -> dict:
    info = {
        "active_backend": "supabase" if SUPABASE_CONFIGURED else "sqlite",
        "persistent": SUPABASE_CONFIGURED,
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

    if SUPABASE_CONFIGURED:
        try:
            users = _remote(
                "storage diagnostics",
                lambda client: client.table("users").select("status").execute().data,
            )
            info["reachable"] = True
            info["user_count"] = len(users)
            info["status_counts"] = {
                status: sum(1 for user in users if user.get("status") == status)
                for status in sorted(VALID_STATUSES)
            }
            info["error"] = None
        except Exception as exc:
            info["reachable"] = False
            info["user_count"] = None
            info["status_counts"] = None
            info["error"] = f"{type(exc).__name__}: {exc}"
        return info

    info.update({
        "seed_db_path": str(SEED_DB_PATH),
        "active_db_path": str(LOCAL_DB_PATH),
        "app_dir_writable": _dir_is_writable(SEED_DB_PATH.parent),
        "first_open_error": _local_db_error,
    })
    try:
        conn = _get_local_conn()
        with _local_lock:
            rows = conn.execute(
                "SELECT status, COUNT(*) FROM users GROUP BY status"
            ).fetchall()
            log_count = conn.execute("SELECT COUNT(*) FROM download_logs").fetchone()[0]
        counts = {status: 0 for status in sorted(VALID_STATUSES)}
        counts.update({row[0]: row[1] for row in rows})
        info["reachable"] = True
        info["user_count"] = sum(counts.values())
        info["status_counts"] = counts
        info["download_log_count"] = log_count
        info["error"] = None
    except Exception as exc:
        info["reachable"] = False
        info["user_count"] = None
        info["status_counts"] = None
        info["download_log_count"] = None
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info
