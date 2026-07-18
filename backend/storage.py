import os
import sqlite3
import threading
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
LOCAL_DB_PATH = backend_dir / "unistream_local.sqlite3"

_local_lock = threading.Lock()
_local_conn: sqlite3.Connection | None = None
_supabase: Client | None = None
_use_local_storage = True


def normalize(identifier: str) -> str:
    return identifier.strip().lower()


def _get_local_conn() -> sqlite3.Connection:
    global _local_conn
    if _local_conn is None:
        conn = sqlite3.connect(LOCAL_DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        _local_conn = conn
        _init_local_db()
    return _local_conn


def _init_local_db() -> None:
    conn = _local_conn
    if conn is None:
        return
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


def list_users(status: str | None = None):
    if _use_local_storage or _supabase is None:
        conn = _get_local_conn()
        query = "SELECT * FROM users"
        params: tuple = ()
        if status:
            query += " WHERE status = ?"
            params = (status,)
        query += " ORDER BY created_at DESC"
        rows = conn.execute(query, params).fetchall()
        return [_row_to_dict(row) for row in rows]

    query = _supabase.table("users").select("*").order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    resp = query.execute()
    return resp.data


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


def list_download_logs(limit: int = 50):
    if _use_local_storage or _supabase is None:
        conn = _get_local_conn()
        rows = conn.execute(
            "SELECT * FROM download_logs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_dict(row) for row in rows]

    resp = (
        _supabase.table("download_logs")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return resp.data


def set_user_status(identifier: str, status: str):
    return update_user_status(identifier, status)