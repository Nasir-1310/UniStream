# backend/routers/admin.py
"""Admin endpoints: dashboard, users, credentials, download logs, settings.

Every route requires the x-admin-secret header (dependencies.require_admin).
Routes are plain functions, so FastAPI runs them in its thread pool and the
blocking storage and email calls never stall the event loop.

Passwords: approving an account (or "send password") generates a temporary
password, stores only its hash and emails it. The plain password is returned
to the admin only when the email could not be sent, so it can be shared by
hand; it is never logged.

Supabase without supabase_migration_v2.sql: the overview and settings still
answer (with system.schema_ready = false and default values) so the panel can
show the admin the script to run; other routes answer 503 with that advice.
"""

import csv
import io
import logging
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator

import email_service
import security
import storage
from dependencies import (
    DEFAULT_DAILY_LIMIT,
    MAX_DAILY_LIMIT,
    admin_user,
    check_daily_limit,
    clean_note,
    default_daily_limit,
    effective_limit,
    hash_password,
    require_admin,
)
from yt_dlp_config import (
    js_runtime_options,
    youtube_auth_mode,
    youtube_client_report,
    youtube_proxy,
)


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])
logger = logging.getLogger(__name__)

MAX_BULK_USERS = 200
MAX_BULK_LOGS = 500
EXPORT_ROW_LIMIT = 50_000
# Bulk approvals send one email each; a few in parallel keep 200 approvals
# well inside the panel's request timeout without tripping provider limits.
BULK_WORKERS = 4

USER_NOT_FOUND = "User not found."
DUPLICATE_MESSAGES = {
    "email": "Another account already uses this email address.",
    "phone": "Another account already uses this phone number.",
}
NO_EMAIL_ERROR = "This account has no email address. Share the password with the user yourself."


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Request bodies ────────────────────────────────────────────────────────────

class UserFields(BaseModel):
    """Profile fields shared by create and edit; validators reuse security.py
    so the panel shows the same messages as the sign-up form."""

    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    note: Optional[str] = None
    daily_limit: Optional[int] = None

    # Validators run only for keys that were sent, so an edit that sends
    # "email": null is rejected with "Please enter your email address."
    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, value):
        return security.validate_name(value)

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, value):
        return security.validate_email(value)

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, value):
        return security.validate_phone(value)

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, value):
        return clean_note(value, label="Note", max_length=500, multiline=True)

    @field_validator("daily_limit", mode="before")
    @classmethod
    def _daily_limit(cls, value):
        return check_daily_limit(value)


class CreateUserRequest(UserFields):
    name: str
    email: str
    phone: str
    status: Literal["approved", "pending"] = "approved"
    send_credentials: bool = True


class UpdateUserRequest(UserFields):
    """Only the keys sent are changed; "daily_limit": null restores the default."""


class ApproveRequest(BaseModel):
    send_credentials: bool = True


class StatusRequest(BaseModel):
    status: Literal["approved", "pending", "blocked"]


class BulkUsersRequest(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=MAX_BULK_USERS)
    action: Literal["approve", "block", "pending", "delete"]
    send_credentials: bool = True

    @field_validator("ids")
    @classmethod
    def _ids(cls, value):
        # Keep the first occurrence of each id, in order.
        ids = list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))
        if not ids:
            raise ValueError("Select at least one user.")
        return ids


class DeleteLogsRequest(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=MAX_BULK_LOGS)


class PurgeLogsRequest(BaseModel):
    """Exactly one of older_than_days, before (YYYY-MM-DD) or all=true."""

    older_than_days: Optional[int] = Field(None, ge=1, le=36500)
    before: Optional[date] = None
    all: bool = False

    @model_validator(mode="after")
    def _exactly_one(self):
        chosen = [self.older_than_days is not None, self.before is not None, self.all]
        if sum(chosen) != 1:
            raise ValueError(
                "Choose exactly one: older_than_days, before (YYYY-MM-DD) or all."
            )
        return self


class SettingsUpdate(BaseModel):
    default_daily_limit: int

    @field_validator("default_daily_limit", mode="before")
    @classmethod
    def _limit(cls, value):
        message = f"The default daily limit must be a whole number from 0 to {MAX_DAILY_LIMIT}."
        try:
            number = check_daily_limit(value)
        except ValueError:
            raise ValueError(message) from None
        if number is None or number < 0:
            raise ValueError(message)
        return number


class TestEmailRequest(BaseModel):
    to: str

    @field_validator("to", mode="before")
    @classmethod
    def _to(cls, value):
        return security.validate_email(value)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _default_limit_or_fallback() -> int:
    """The default limit, or 4 while the Supabase schema is outdated."""
    try:
        return default_daily_limit()
    except storage.SchemaOutdatedError:
        return DEFAULT_DAILY_LIMIT


def _user_or_404(user_id: str) -> dict:
    user = storage.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    return user


def _updated_or_404(user: dict | None) -> dict:
    if user is None:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    return user


def _issue_credentials(user: dict, default_limit: int, *, new_password: bool) -> tuple[dict, dict]:
    """Give the account a new temporary password and email it.

    Returns (account, CredentialsResult). The plain password is returned
    only when it was not emailed, so the admin can pass it on by hand.
    """
    password = security.generate_password()
    user = _updated_or_404(storage.update_user(user["id"], {
        "password_hash": hash_password(password),
        "temp_password": True,
    }))
    for value in {user.get("email"), user.get("phone"), user.get("identifier")}:
        if value:
            security.rate_limiter.clear("login_attempts", value)

    address = user.get("email")
    if not address:
        return user, {"emailed": False, "email_error": NO_EMAIL_ERROR, "password": password}
    try:
        email_service.send_credentials_email(
            to=address,
            name=user.get("name") or "",
            login=address,
            password=password,
            daily_limit=effective_limit(user, default_limit),
            login_url=f"{email_service.app_url()}/",
            phone=user.get("phone"),
            new_password=new_password,
        )
    except email_service.EmailError as exc:
        return user, {"emailed": False, "email_error": str(exc), "password": password}
    except Exception:  # noqa: BLE001 - the password must still reach the admin
        logger.exception("Unexpected error while emailing credentials")
        return user, {
            "emailed": False,
            "email_error": "The email could not be sent. Share the password with the user yourself.",
            "password": password,
        }

    try:
        user = storage.update_user(user["id"], {"credentials_sent_at": _now()}) or user
    except storage.StorageUnavailableError as exc:
        # The email went out; failing the request now would hide that.
        logger.warning("Could not record credentials_sent_at: %s", exc)
    return user, {"emailed": True, "email_error": None, "password": None}


def _approve(user: dict, send_credentials: bool, default_limit: int) -> tuple[dict, dict | None]:
    """Approve an account and, if asked, issue it a temporary password.

    An account that is already approved and has a password keeps it: use
    "send password" to replace it. This keeps a bulk approval that includes
    active users from signing them out.
    """
    already_active = user.get("status") == "approved" and bool(user.get("password_hash"))
    fields: dict = {"status": "approved"}
    if user.get("status") != "approved" or not user.get("approved_at"):
        fields["approved_at"] = _now()
    had_password = bool(user.get("password_hash"))
    user = _updated_or_404(storage.update_user(user["id"], fields))
    if not send_credentials or already_active:
        return user, None
    return _issue_credentials(user, default_limit, new_password=had_password)


def _set_status(user: dict, status: str) -> dict:
    fields: dict = {"status": status}
    if status == "approved" and not user.get("approved_at"):
        fields["approved_at"] = _now()
    return _updated_or_404(storage.update_user(user["id"], fields))


def _parse_day(value: str | None, label: str) -> date | None:
    if value is None or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"{label} must be a date in YYYY-MM-DD format.",
        ) from None


def _log_filters(q, platform, user_id, date_from, date_to) -> dict:
    """Storage filters; dates are whole local days and date_to is inclusive."""
    start = _parse_day(date_from, "Start date")
    end = _parse_day(date_to, "End date")
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="The start date must be on or before the end date.")
    return {
        "q": q or None,
        "platform": platform or None,
        "user_id": user_id or None,
        "date_from": security.local_midnight(start) if start else None,
        "date_to": security.local_midnight(end + timedelta(days=1)) if end else None,
    }


def _settings_payload() -> dict:
    return {
        "default_daily_limit": _default_limit_or_fallback(),
        "timezone": security.app_timezone_name(),
        "email": email_service.email_status(),
        "auth_secret_configured": security.auth_secret_configured(),
        "schema": storage.schema_status(),
        "frontend_url": email_service.app_url(),
    }


_KNOWN_PLATFORMS = {label.lower(): label for label in security.PLATFORM_LABELS.values()}


def _platform_name(value: str | None) -> str:
    text = (value or "").strip()
    return _KNOWN_PLATFORMS.get(text.lower(), text or "Other")


# Leading characters that make Excel/Sheets treat a cell as a formula. Video
# titles come from the internet, so they are neutralised in exports.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_cell(value) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/overview")
def overview():
    counts = storage.user_status_counts()
    schema = storage.schema_status()
    zone_name = security.app_timezone_name()
    today = security.local_today()
    first_day = today - timedelta(days=29)

    try:
        stats = storage.download_stats(since=security.local_midnight(first_day), tz=zone_name)
    except storage.SchemaOutdatedError:
        stats = []

    per_day: Counter = Counter()
    platforms: Counter = Counter({label: 0 for label in security.PLATFORM_LABELS.values()})
    for row in stats:
        if row["day"] < first_day.isoformat():
            continue
        per_day[row["day"]] += row["downloads"]
        platforms[_platform_name(row["platform"])] += row["downloads"]

    def total_since(days: int) -> int:
        start = (today - timedelta(days=days - 1)).isoformat()
        return sum(count for day, count in per_day.items() if day >= start)

    daily = [
        {"date": day.isoformat(), "count": per_day[day.isoformat()]}
        for day in (today - timedelta(days=offset) for offset in range(13, -1, -1))
    ]
    return {
        "users": {key: counts[key] for key in ("total", "pending", "approved", "blocked")},
        "downloads": {
            "today": per_day[today.isoformat()],
            "last_7_days": total_since(7),
            "last_30_days": total_since(30),
            "daily": daily,
            "platforms": dict(platforms),
        },
        "settings": {"default_daily_limit": _default_limit_or_fallback()},
        "system": {
            "schema_ready": bool(schema["ready"]),
            "email": email_service.email_status(),
            "auth_secret_configured": security.auth_secret_configured(),
            "storage": "supabase" if storage.SUPABASE_CONFIGURED else "sqlite",
            "persistent": bool(storage.SUPABASE_CONFIGURED),
            "timezone": zone_name,
        },
    }


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
def list_users(
    status: Optional[Literal["approved", "pending", "blocked", "all"]] = None,
    q: Optional[str] = Query(None, max_length=100),
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(25, ge=1, le=storage.MAX_USER_PAGE_SIZE),
    sort: Literal[
        "created_at", "name", "last_login_at", "last_download_at", "total_downloads", "status",
    ] = "created_at",
    order: Literal["asc", "desc"] = "desc",
):
    result = storage.list_users(
        status=None if status in (None, "all") else status,
        q=q, page=page, page_size=page_size, sort=sort, order=order,
    )
    default_limit = default_daily_limit()
    today = security.local_today()
    return {
        "items": [admin_user(user, default_limit, today) for user in result["items"]],
        "total": result["total"],
        "page": page,
        "page_size": page_size,
    }


@router.post("/users", status_code=201)
def create_user(body: CreateUserRequest):
    default_limit = default_daily_limit()
    try:
        user = storage.create_user(
            name=body.name, email=body.email, phone=body.phone, note=body.note,
            status=body.status, daily_limit=body.daily_limit,
        )
    except storage.DuplicateUserError as exc:
        raise HTTPException(status_code=409, detail=DUPLICATE_MESSAGES[exc.field]) from None
    credentials = None
    if body.status == "approved" and body.send_credentials:
        user, credentials = _issue_credentials(user, default_limit, new_password=False)
    return {"user": admin_user(user, default_limit), "credentials": credentials}


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UpdateUserRequest):
    fields = {key: getattr(body, key) for key in body.model_fields_set}
    try:
        user = storage.update_user(user_id, fields) if fields else storage.get_user_by_id(user_id)
    except storage.DuplicateUserError as exc:
        raise HTTPException(status_code=409, detail=DUPLICATE_MESSAGES[exc.field]) from None
    return {"user": admin_user(_updated_or_404(user), default_daily_limit())}


@router.post("/users/{user_id}/approve")
def approve_user(user_id: str, body: Optional[ApproveRequest] = None):
    body = body or ApproveRequest()
    default_limit = default_daily_limit()
    user, credentials = _approve(_user_or_404(user_id), body.send_credentials, default_limit)
    return {"user": admin_user(user, default_limit), "credentials": credentials}


@router.post("/users/{user_id}/status")
def set_user_status(user_id: str, body: StatusRequest):
    user = _set_status(_user_or_404(user_id), body.status)
    return {"user": admin_user(user, default_daily_limit())}


@router.post("/users/{user_id}/send-password")
def send_password(user_id: str):
    """Replace the password with a new temporary one (signs out every session)."""
    user = _user_or_404(user_id)
    if user.get("status") != "approved":
        raise HTTPException(
            status_code=400,
            detail="Approve this account before sending it a password.",
        )
    default_limit = default_daily_limit()
    user, credentials = _issue_credentials(user, default_limit, new_password=True)
    return {"user": admin_user(user, default_limit), "credentials": credentials}


@router.post("/users/{user_id}/reset-usage")
def reset_usage(user_id: str):
    _user_or_404(user_id)
    user = storage.update_user(user_id, {
        "downloads_today": 0,
        "usage_date": security.local_today(),
    })
    return {"user": admin_user(_updated_or_404(user), default_daily_limit())}


@router.delete("/users/{user_id}")
def delete_user(user_id: str):
    if not storage.delete_user(user_id):
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    return {"deleted": True}


@router.post("/users/bulk")
def bulk_users(body: BulkUsersRequest):
    default_limit = default_daily_limit()

    def apply(user_id: str) -> dict:
        result = {"id": user_id, "ok": False, "error": None, "credentials": None}
        try:
            if body.action == "delete":
                if storage.delete_user(user_id):
                    result["ok"] = True
                else:
                    result["error"] = USER_NOT_FOUND
                return result
            user = storage.get_user_by_id(user_id)
            if user is None:
                result["error"] = USER_NOT_FOUND
            elif body.action == "approve":
                _user, result["credentials"] = _approve(user, body.send_credentials, default_limit)
                result["ok"] = True
            else:
                _set_status(user, "blocked" if body.action == "block" else "pending")
                result["ok"] = True
        except HTTPException as exc:
            result["error"] = str(exc.detail)
        except storage.StorageUnavailableError as exc:
            result["error"] = str(exc)
        return result

    with ThreadPoolExecutor(max_workers=min(BULK_WORKERS, len(body.ids))) as pool:
        results = list(pool.map(apply, body.ids))
    return {"results": results}


# ── Download logs ─────────────────────────────────────────────────────────────

@router.get("/logs")
def list_logs(
    q: Optional[str] = Query(None, max_length=200),
    platform: Optional[str] = Query(None, max_length=32),
    user_id: Optional[str] = Query(None, max_length=64),
    date_from: Optional[str] = Query(None, max_length=10),
    date_to: Optional[str] = Query(None, max_length=10),
    page: int = Query(1, ge=1, le=1_000_000),
    page_size: int = Query(50, ge=1, le=storage.MAX_LOG_PAGE_SIZE),
):
    filters = _log_filters(q, platform, user_id, date_from, date_to)
    result = storage.list_download_logs(**filters, page=page, page_size=page_size)
    return {"items": result["items"], "total": result["total"], "page": page, "page_size": page_size}


@router.get("/logs/export")
def export_logs(
    q: Optional[str] = Query(None, max_length=200),
    platform: Optional[str] = Query(None, max_length=32),
    user_id: Optional[str] = Query(None, max_length=64),
    date_from: Optional[str] = Query(None, max_length=10),
    date_to: Optional[str] = Query(None, max_length=10),
):
    """The filtered logs as CSV (newest first, at most 50,000 rows).

    The first page is read before the response starts, so a database outage
    still answers 503 instead of an empty or half-written file. The BOM makes
    Excel open the file as UTF-8 (Bangla titles stay readable).
    """
    filters = _log_filters(q, platform, user_id, date_from, date_to)
    rows = storage.iter_download_logs(**filters, limit=EXPORT_ROW_LIMIT)
    zone = security.app_timezone()
    zone_name = security.app_timezone_name()
    filename = f"download-logs-{security.local_today():%Y%m%d}.csv"

    def generate():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow([
            f"Downloaded at ({zone_name})", "Downloaded at (UTC)", "User", "User ID",
            "Platform", "Title", "Quality", "File size (bytes)", "URL", "Log ID",
        ])
        yield "﻿" + buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()
        try:
            for count, log in enumerate(rows, 1):
                created = log.get("created_at")
                try:
                    local = datetime.fromisoformat(created).astimezone(zone).strftime("%Y-%m-%d %H:%M:%S")
                except (TypeError, ValueError):
                    local = ""
                writer.writerow([
                    local, created or "", _csv_cell(log.get("identifier")), log.get("user_id") or "",
                    _csv_cell(log.get("platform")), _csv_cell(log.get("title")),
                    _csv_cell(log.get("quality")),
                    "" if log.get("file_size") is None else log["file_size"],
                    _csv_cell(log.get("url")), log.get("id") or "",
                ])
                if count % 500 == 0:
                    yield buffer.getvalue()
                    buffer.seek(0)
                    buffer.truncate()
        except storage.StorageUnavailableError as exc:
            logger.warning("Log export stopped early: %s", exc)
            writer.writerow(["Export incomplete: the database stopped responding. Please try again."])
        yield buffer.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/logs/delete")
def delete_logs(body: DeleteLogsRequest):
    return {"deleted": storage.delete_download_logs(body.ids)}


@router.post("/logs/purge")
def purge_logs(body: PurgeLogsRequest):
    """Delete old logs in bulk: older than N days, before a local date, or all."""
    if body.all:
        before = None
    elif body.before is not None:
        before = security.local_midnight(body.before)
    else:
        before = _now() - timedelta(days=body.older_than_days)
    return {"deleted": storage.purge_download_logs(before=before)}


@router.delete("/logs/{log_id}")
def delete_log(log_id: str):
    return {"deleted": storage.delete_download_logs([log_id])}


# ── Settings and system ───────────────────────────────────────────────────────

@router.get("/settings")
def get_settings():
    return _settings_payload()


@router.put("/settings")
def update_settings(body: SettingsUpdate):
    storage.set_setting("default_daily_limit", str(body.default_daily_limit))
    return _settings_payload()


@router.post("/email/test")
def send_test_email(body: TestEmailRequest):
    try:
        email_service.send_test_email(body.to)
    except email_service.EmailError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    return {"sent": True}


@router.get("/schema")
def schema():
    """Re-checks the database (the admin just ran the script) and returns it."""
    status = storage.schema_status(refresh=True)
    return {
        "ready": status["ready"],
        "missing": status["missing"],
        "migration_sql": storage.migration_sql(),
    }


@router.get("/storage")
def storage_health():
    """
    Reports which store is live, where the SQLite file ended up, whether the
    v2 schema is in place, and the versions of the two tools a download
    depends on. Without it a deployment that answers "/" fine but 500s on
    every database call can only be diagnosed from the host's own logs.
    """
    import yt_dlp
    from routers.download import FFMPEG_LOCATION

    info = storage.storage_diagnostics()
    info["yt_dlp_version"] = yt_dlp.version.__version__
    info["ffmpeg_location"] = FFMPEG_LOCATION
    info["youtube_auth"] = youtube_auth_mode()
    info["youtube_proxy"] = "configured" if youtube_proxy() else "not configured"
    info["js_runtime"] = js_runtime_options().get("js_runtimes", {}).get("deno", {}).get("path")
    return info


@router.get("/youtube-check")
def youtube_check(url: str = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"):
    """
    Lists which YouTube clients return which resolutions from this server's IP.
    YouTube treats data-centre IPs differently, so a video that lists every
    resolution locally can list only 360p here; this shows which client to use.
    Takes a minute or two: each client is probed separately.
    """
    import yt_dlp

    return {
        "commit": os.getenv("RENDER_GIT_COMMIT", "")[:7] or "local",
        "yt_dlp_version": yt_dlp.version.__version__,
        "youtube_auth": youtube_auth_mode(),
        "youtube_proxy": "configured" if youtube_proxy() else "not configured",
        "js_runtime": js_runtime_options().get("js_runtimes", {}).get("deno", {}).get("path"),
        "clients": youtube_client_report(url),
    }
