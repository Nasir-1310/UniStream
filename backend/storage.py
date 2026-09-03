import os
import shutil
import sqlite3
import tempfile
import threading
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# The database committed to the repo.  It seeds a fresh deployment, and is the
# live file whenever the checkout is writable.
SEED_DB_PATH = backend_dir / "unistream_local.sqlite3"


def _dir_is_writable(directory: Path) -> bool:
    probe = directory / ".unistream_write_probe"
    try:
        probe.touch()
        probe.unlink()
        return True
    except Exception:
        return False


def _resolve_db_path() -> Path:
    """
    Pick a writable location for the SQLite file.

    SQLite puts its journal next to the database, and the schema bootstrap runs
    a CREATE TABLE on first connect, so a read-only application directory makes
    every query raise -- which shows up as a 500 on every endpoint that touches
    the database while the endpoints that do not keep answering normally.  When
    the checkout is not writable, run from a copy under the temp directory,
    seeded from the committed database so approved users survive.
    """
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

_local_lock = threading.Lock()
_local_conn: sqlite3.Connection | None = None
_local_db_error: str | None = None
_supabase: Client | None = None
_use_local_storage = True


def normalize(identifier: str) -> str:
    return identifier.strip().lower()


def _get_local_conn() -> sqlite3.Connection:
    global _local_conn, LOCAL_DB_PATH, _local_db_error
    if _local_conn is None:
        try:
            _local_conn = _open_conn(LOCAL_DB_PATH)
            _local_db_error = None
        except Exception as exc:
            # A committed database can still arrive unusable -- a read-only
            # directory, a corrupted checkout.  Record why, then start a fresh
            # database rather than failing every request that needs storage.
            _local_db_error = f"{type(exc).__name__}: {exc}"
            fallback = Path(tempfile.gettempdir()) / "unistream_fallback.sqlite3"
            if fallback == LOCAL_DB_PATH:
                raise
            LOCAL_DB_PATH = fallback
            _local_conn = _open_conn(LOCAL_DB_PATH)
    return _local_conn


def _open_conn(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    _create_schema(conn)
    return conn


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


def _row_to_dict(row) -> dict:
    return dict(row) if row is not None else {}


def _probe_supabase() -> bool:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False

    try:
        client = create_client(SUPABASE_URL, SUPABASE_KEY)
        client.table("users").select("id").limit(1).execute()
        return True
    except Exception:
        return False


if _probe_supabase():
    _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    _use_local_storage = False


def _local_get_user(identifier: str):
    conn = _get_local_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE identifier = ?",
        (normalize(identifier),),
    ).fetchone()
    return _row_to_dict(row) if row else None


def _remote_get_user(identifier: str):
    if _supabase is None:
        return None
    resp = (
        _supabase.table("users")
        .select("*")
        .eq("identifier", normalize(identifier))
        .execute()
    )
    return resp.data[0] if resp.data else None


def get_user(identifier: str):
    global _use_local_storage
    if not _use_local_storage:
        try:
            return _remote_get_user(identifier)
        except (httpx.HTTPError, Exception):
            _use_local_storage = True

    return _local_get_user(identifier)


def upsert_pending_user(identifier: str):
    global _use_local_storage
    normalized = normalize(identifier)
    if _use_local_storage or _supabase is None:
        conn = _get_local_conn()
        with _local_lock:
            existing = conn.execute(
                "SELECT * FROM users WHERE identifier = ?",
                (normalized,),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE users
                    SET status = 'pending', updated_at = CURRENT_TIMESTAMP
                    WHERE identifier = ?
                    """,
                    (normalized,),
                )
            else:
                conn.execute(
                    "INSERT INTO users (identifier, status) VALUES (?, 'pending')",
                    (normalized,),
                )
            conn.commit()
        return _local_get_user(normalized)

    try:
        _supabase.table("users").upsert(
            {
                "identifier": normalized,
                "status": "pending",
            }
        ).execute()
        return _remote_get_user(normalized)
    except Exception:
        _use_local_storage = True
        return upsert_pending_user(normalized)


def _local_list_users(status: str | None = None):
    conn = _get_local_conn()
    query = "SELECT * FROM users"
    params: tuple = ()
    if status:
        query += " WHERE status = ?"
        params = (status,)
    query += " ORDER BY created_at DESC"
    rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(row) for row in rows]


def list_users(status: str | None = None):
    global _use_local_storage
    if _use_local_storage or _supabase is None:
        return _local_list_users(status)

    try:
        query = _supabase.table("users").select("*").order("created_at", desc=True)
        if status:
            query = query.eq("status", status)
        resp = query.execute()
        return resp.data
    except Exception:
        _use_local_storage = True
        return _local_list_users(status)


def upsert_user(identifier: str, status: str, note: str | None = None, name: str | None = None):
    global _use_local_storage
    normalized = normalize(identifier)
    if _use_local_storage or _supabase is None:
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
                    SET status = ?, note = ?, name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP
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

    try:
        existing = get_user(normalized)
        payload = {"status": status, "note": note, "name": name}
        payload = {key: value for key, value in payload.items() if value is not None}
        if existing:
            _supabase.table("users").update(payload).eq("identifier", normalized).execute()
        else:
            payload["identifier"] = normalized
            _supabase.table("users").insert(payload).execute()
        return _remote_get_user(normalized)
    except Exception:
        _use_local_storage = True
        return upsert_user(normalized, status, note=note, name=name)


def update_user_status(identifier: str, status: str):
    global _use_local_storage
    normalized = normalize(identifier)
    if _use_local_storage or _supabase is None:
        conn = _get_local_conn()
        with _local_lock:
            conn.execute(
                """
                UPDATE users
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE identifier = ?
                """,
                (status, normalized),
            )
            conn.commit()
        return _local_get_user(normalized)

    try:
        _supabase.table("users").update({"status": status}).eq("identifier", normalized).execute()
        return _remote_get_user(normalized)
    except Exception:
        _use_local_storage = True
        return update_user_status(normalized, status)


def delete_user(identifier: str):
    global _use_local_storage
    normalized = normalize(identifier)
    if _use_local_storage or _supabase is None:
        conn = _get_local_conn()
        with _local_lock:
            conn.execute("DELETE FROM users WHERE identifier = ?", (normalized,))
            conn.commit()
        return

    try:
        _supabase.table("users").delete().eq("identifier", normalized).execute()
    except Exception:
        _use_local_storage = True
        delete_user(normalized)


async def log_download(identifier: str, url: str, title: str = "", platform: str = "") -> None:
    global _use_local_storage
    normalized = normalize(identifier)
    if _use_local_storage or _supabase is None:
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

    try:
        _supabase.table("download_logs").insert(
            {
                "identifier": normalized,
                "url": url,
                "title": title,
                "platform": platform,
            }
        ).execute()
    except Exception:
        _use_local_storage = True
        await log_download(normalized, url, title, platform)


def _local_list_download_logs(limit: int = 50):
    conn = _get_local_conn()
    rows = conn.execute(
        "SELECT * FROM download_logs ORDER BY created_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [_row_to_dict(row) for row in rows]


def list_download_logs(limit: int = 50):
    global _use_local_storage
    if _use_local_storage or _supabase is None:
        return _local_list_download_logs(limit)

    try:
        resp = (
            _supabase.table("download_logs")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data
    except Exception:
        _use_local_storage = True
        return _local_list_download_logs(limit)


def set_user_status(identifier: str, status: str):
    return update_user_status(identifier, status)

def storage_diagnostics() -> dict:
    """
    Admin-only view of which store is live and why.  Renders a deployment
    failure diagnosable without shell access to the host, which is the only way
    to tell a dead Supabase project apart from an unwritable SQLite file.
    """
    info = {
        "active_backend": "sqlite" if (_use_local_storage or _supabase is None) else "supabase",
        "supabase_url_configured": bool(SUPABASE_URL),
        "supabase_key_configured": bool(SUPABASE_KEY),
        "seed_db_path": str(SEED_DB_PATH),
        "seed_db_exists": SEED_DB_PATH.exists(),
        "app_dir_writable": _dir_is_writable(SEED_DB_PATH.parent),
        "first_open_error": _local_db_error,
    }
    try:
        conn = _get_local_conn()
        info["active_db_path"] = str(LOCAL_DB_PATH)
        info["user_count"] = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        info["approved_users"] = [
            row[0] for row in conn.execute(
                "SELECT identifier FROM users WHERE status = 'approved'"
            )
        ]
        info["sqlite_error"] = None
    except Exception as exc:
        info["active_db_path"] = str(LOCAL_DB_PATH)
        info["user_count"] = None
        info["approved_users"] = None
        info["sqlite_error"] = f"{type(exc).__name__}: {exc}"
    return info
