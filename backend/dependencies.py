# backend/dependencies.py
"""Shared FastAPI dependencies and account helpers used by every router.

* require_user / require_admin guard the user and admin endpoints.
* The quota helpers turn a stored account into today's allowance, and the
  in-memory download reservations stop parallel downloads from overshooting
  it: a download only counts once it completes, so without a reservation two
  downloads started together could both pass a "3 of 4 used" check.
* public_user / admin_user are the only shapes accounts leave the API in, so
  password hashes never reach a response.

Storage calls here are synchronous: FastAPI runs sync dependencies and routes
in its thread pool, and async routes call these helpers via asyncio.to_thread.
"""

import hashlib
import hmac
import math
import os
import threading
import unicodedata
from datetime import date

from fastapi import Header, HTTPException, Query, Request

import security
import storage


SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again."
PENDING_MESSAGE = (
    "Your account is waiting for admin approval. You'll get an email when it's approved."
)
BLOCKED_MESSAGE = "Your account has been blocked. Contact the administrator."

DEFAULT_DAILY_LIMIT = 4
MAX_DAILY_LIMIT = 10_000
UNLIMITED = -1
MAX_CONCURRENT_DOWNLOADS_PER_USER = 2

# Failed admin-secret attempts allowed per client IP and window.
ADMIN_FAILURE_LIMIT = 10
ADMIN_FAILURE_WINDOW_SECONDS = 15 * 60


# ── Errors ────────────────────────────────────────────────────────────────────

def wait_text(retry_after_seconds: int) -> str:
    """"5 minutes" / "1 minute": rate-limit messages name a wait people can act on."""
    minutes = max(1, math.ceil(retry_after_seconds / 60))
    return f"{minutes} minute{'' if minutes == 1 else 's'}"


def too_many_requests(message: str, retry_after_seconds: int) -> HTTPException:
    """429 whose detail ends with the wait; `message` contains "{wait}"."""
    return HTTPException(
        status_code=429,
        detail=message.format(wait=wait_text(retry_after_seconds)),
        headers={"Retry-After": str(max(1, int(retry_after_seconds)))},
    )


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=SESSION_EXPIRED_MESSAGE,
        headers={"WWW-Authenticate": "Bearer"},
    )


def status_error(user: dict) -> HTTPException | None:
    """403 for an account that may not use the service, else None."""
    if user.get("status") == "blocked":
        return HTTPException(status_code=403, detail=BLOCKED_MESSAGE)
    if user.get("status") != "approved":
        return HTTPException(status_code=403, detail=PENDING_MESSAGE)
    return None


# ── Passwords ─────────────────────────────────────────────────────────────────
# Each scrypt run holds 16 MiB for ~60 ms. A burst of sign-ins (a whole
# classroom at once) or a flood of guesses on a 512 MB instance could run out
# of memory, so only a few run at a time; the rest wait their turn briefly.
_PASSWORD_WORK = threading.BoundedSemaphore(4)


def hash_password(password: str) -> str:
    with _PASSWORD_WORK:
        return security.hash_password(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    with _PASSWORD_WORK:
        return security.verify_password(password, stored_hash)


# ── Sessions ──────────────────────────────────────────────────────────────────

def issue_session(user: dict) -> str:
    """Session token bound to the current password: any password change ends it."""
    return security.create_token(
        user["id"],
        security.password_version(user.get("password_hash")),
        "session",
        security.SESSION_TTL_SECONDS,
    )


def _token_matches(payload: dict, user: dict) -> bool:
    expected = security.password_version(user.get("password_hash"))
    return hmac.compare_digest(payload["pv"].encode(), expected.encode())


def session_user(token: str | None) -> dict:
    """The approved account a session token belongs to; raises 401/403.

    The token is checked against the stored password version on every
    request, so a password change, reset or admin-issued password signs out
    every other device immediately.
    """
    payload = security.verify_token(token, "session") if token else None
    if payload is None:
        raise _unauthorized()
    user = storage.get_user_by_id(payload["sub"])
    if user is None or not _token_matches(payload, user):
        raise _unauthorized()
    error = status_error(user)
    if error is not None:
        raise error
    return user


def bearer_token(authorization: str | None, token: str | None = None) -> str | None:
    """Token from "Authorization: Bearer ..." or, failing that, `?token=`.

    The query form exists for EventSource, which cannot send headers.
    """
    if authorization:
        scheme, _, value = authorization.strip().partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
    return token.strip() if token and token.strip() else None


def require_user(
    authorization: str | None = Header(None),
    token: str | None = Query(None, max_length=2048, description="Session token (for EventSource)"),
) -> dict:
    """FastAPI dependency: the signed-in, approved account (storage row)."""
    return session_user(bearer_token(authorization, token))


# ── Admin ─────────────────────────────────────────────────────────────────────

def require_admin(request: Request, x_admin_secret: str | None = Header(None)) -> None:
    """FastAPI dependency for every /admin route.

    The secret is read at call time so a redeploy with a new value (or a
    test) takes effect without code changes. Failed guesses are limited per
    client IP; a missing header is not counted, since it is never a guess.
    """
    secret = os.getenv("ADMIN_SECRET", "").strip()
    if not secret:
        raise HTTPException(
            status_code=503,
            detail="Admin access is not configured. Set ADMIN_SECRET on the server.",
        )
    ip = security.client_ip(request)
    allowed, retry_after = security.rate_limiter.check(
        "admin_failures", ip, ADMIN_FAILURE_LIMIT, ADMIN_FAILURE_WINDOW_SECONDS,
    )
    if not allowed:
        raise too_many_requests(
            "Too many failed admin sign-in attempts. Try again in {wait}.", retry_after,
        )
    given = (x_admin_secret or "").strip()
    if not given or not hmac.compare_digest(given.encode("utf-8"), secret.encode("utf-8")):
        if given and _first_time_wrong_secret(ip, given):
            security.rate_limiter.hit(
                "admin_failures", ip, ADMIN_FAILURE_LIMIT, ADMIN_FAILURE_WINDOW_SECONDS,
            )
        raise HTTPException(status_code=401, detail="Invalid admin secret.")


def _first_time_wrong_secret(ip: str, given: str) -> bool:
    """True the first time this IP sends this wrong secret in the window.

    A dashboard tab still holding a rotated secret fires several requests at
    once, all with the same stale value; counting each would lock the admin
    out of their own IP after a couple of reloads. Repeating one wrong value
    teaches a guesser nothing, so only distinct guesses count as failures.
    """
    fingerprint = hashlib.sha256(given.encode("utf-8")).hexdigest()[:16]
    first, _retry = security.rate_limiter.hit(
        "admin_failure_guesses", f"{ip}|{fingerprint}", 1, ADMIN_FAILURE_WINDOW_SECONDS,
    )
    return first


# ── Field helpers shared by request models ────────────────────────────────────

def clean_note(value, *, label: str, max_length: int, multiline: bool = False) -> str | None:
    """Optional free text: trimmed, None when blank, length-capped.

    Control characters (other than line breaks in multi-line admin notes)
    are rejected: they render as garbage in the admin panel and CSV exports.
    """
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text.")
    if multiline:
        text = "\n".join(" ".join(line.split()) for line in value.strip().splitlines()).strip()
    else:
        text = " ".join(value.split())
    if not text:
        return None
    if any(unicodedata.category(ch) == "Cc" and ch != "\n" for ch in text):
        raise ValueError(f"{label} contains invalid characters.")
    if len(text) > max_length:
        raise ValueError(f"{label} must be at most {max_length} characters.")
    return text


DAILY_LIMIT_MESSAGE = (
    f"Daily limit must be a whole number from 0 to {MAX_DAILY_LIMIT}, "
    f"or {UNLIMITED} for unlimited."
)


def check_daily_limit(value) -> int | None:
    """None = the default limit, -1 = unlimited, 0..10000 = custom."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, str, float)):
        raise ValueError(DAILY_LIMIT_MESSAGE)
    if isinstance(value, float):
        # JSON allows 5.0, and Python's parser also NaN and Infinity.
        if not math.isfinite(value) or not value.is_integer():
            raise ValueError(DAILY_LIMIT_MESSAGE)
        number = int(value)
    else:
        try:
            number = int(str(value).strip())
        except ValueError:
            raise ValueError(DAILY_LIMIT_MESSAGE) from None
    if number != UNLIMITED and not 0 <= number <= MAX_DAILY_LIMIT:
        raise ValueError(DAILY_LIMIT_MESSAGE)
    return number


# ── Quota ─────────────────────────────────────────────────────────────────────

def default_daily_limit() -> int:
    """The admin-set default (app_settings.default_daily_limit), else 4."""
    raw = storage.get_setting("default_daily_limit", str(DEFAULT_DAILY_LIMIT))
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return DEFAULT_DAILY_LIMIT
    return value if 0 <= value <= MAX_DAILY_LIMIT else DEFAULT_DAILY_LIMIT


def effective_limit(user: dict, default: int) -> int | None:
    """Downloads allowed per day; None means unlimited (daily_limit -1)."""
    limit = user.get("daily_limit")
    if limit is None:
        return default
    return None if limit < 0 else limit


def used_today(user: dict, today: date | None = None) -> int:
    """Completed downloads today; the stored counter belongs to usage_date."""
    today = today or security.local_today()
    if user.get("usage_date") != today.isoformat():
        return 0
    return int(user.get("downloads_today") or 0)


def usage_payload(used: int, limit: int | None) -> dict:
    return {
        "used": used,
        "limit": limit,
        "remaining": None if limit is None else max(0, limit - used),
        "resets_at": security.next_reset_at().isoformat(),
        "timezone": security.app_timezone_name(),
    }


def public_user(user: dict, default_limit: int | None = None) -> dict:
    """The account as its owner sees it (never includes the password hash)."""
    if default_limit is None:
        default_limit = default_daily_limit()
    return {
        "id": user["id"],
        "name": user.get("name"),
        "email": user.get("email"),
        "phone": user.get("phone"),
        "status": user.get("status"),
        "temp_password": bool(user.get("temp_password")),
        "created_at": user.get("created_at"),
        "usage": usage_payload(used_today(user), effective_limit(user, default_limit)),
    }


def admin_user(user: dict, default_limit: int, today: date | None = None) -> dict:
    """The account as the admin panel lists it (never includes the password hash)."""
    return {
        "id": user["id"],
        "identifier": user.get("identifier"),
        "name": user.get("name"),
        "email": user.get("email"),
        "phone": user.get("phone"),
        "note": user.get("note"),
        "status": user.get("status"),
        "daily_limit": user.get("daily_limit"),
        "effective_limit": effective_limit(user, default_limit),
        "used_today": used_today(user, today),
        "total_downloads": int(user.get("total_downloads") or 0),
        "has_password": bool(user.get("password_hash")),
        "temp_password": bool(user.get("temp_password")),
        "approved_at": user.get("approved_at"),
        "credentials_sent_at": user.get("credentials_sent_at"),
        "last_login_at": user.get("last_login_at"),
        "last_download_at": user.get("last_download_at"),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }


# ── Download reservations ─────────────────────────────────────────────────────

class DownloadRefused(Exception):
    """A download may not start. `code` is sent in the SSE error event."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# Per-account locks, striped so memory stays bounded however many accounts
# exist. They serialise the read-check-write steps that must not interleave
# for one account: reserving a download slot against today's usage, counting
# a finished download, and spending a single-use password-reset token.
_USER_LOCKS = tuple(threading.Lock() for _ in range(256))


def user_lock(user_id: str) -> threading.Lock:
    return _USER_LOCKS[hash(str(user_id)) % len(_USER_LOCKS)]


class DownloadSlots:
    """Downloads in progress per account, for this process.

    A start reads the account's usage and reserves a slot under user_lock(),
    and a finish counts the download and releases its slot under the same
    lock, so a start always sees either the reservation or the counted
    download, never neither. Single process by design: run one API worker.
    """

    def __init__(self):
        self._guard = threading.Lock()
        self._active: dict[str, int] = {}

    def active(self, user_id: str) -> int:
        with self._guard:
            return self._active.get(str(user_id), 0)

    def add(self, user_id: str) -> None:
        with self._guard:
            self._active[str(user_id)] = self._active.get(str(user_id), 0) + 1

    def release(self, user_id: str) -> None:
        with self._guard:
            remaining = self._active.get(str(user_id), 0) - 1
            if remaining > 0:
                self._active[str(user_id)] = remaining
            else:
                self._active.pop(str(user_id), None)

    def reset(self) -> None:
        """Forget every reservation (tests)."""
        with self._guard:
            self._active.clear()


download_slots = DownloadSlots()


def _limit_message(limit: int, used: int) -> str:
    zone = security.app_timezone_name()
    if limit == 0:
        return "Downloads are turned off for your account. Contact the administrator."
    if used >= limit:
        plural = "" if limit == 1 else "s"
        return (
            f"You've reached today's limit of {limit} download{plural}. "
            f"It resets at midnight ({zone} time)."
        )
    return (
        "Your remaining downloads for today are already in progress. "
        f"Your limit resets at midnight ({zone} time)."
    )


def reserve_download(token: str | None, url: str) -> tuple[dict, str, int | None]:
    """Pre-flight for a download: (account, platform key, effective limit).

    Raises DownloadRefused with code "auth", "platform", "limit" or "busy".
    On success one slot is held; the caller must end it with
    complete_download() or release_download().
    """
    payload = security.verify_token(token, "session") if token else None
    if payload is None:
        raise DownloadRefused("auth", SESSION_EXPIRED_MESSAGE)
    try:
        platform = security.ensure_supported_url(url)
    except ValueError as exc:
        raise DownloadRefused("platform", str(exc)) from None

    user_id = payload["sub"]
    with user_lock(user_id):
        user = storage.get_user_by_id(user_id)
        if user is None or not _token_matches(payload, user):
            raise DownloadRefused("auth", SESSION_EXPIRED_MESSAGE)
        error = status_error(user)
        if error is not None:
            raise DownloadRefused("auth", error.detail)
        limit = effective_limit(user, default_daily_limit())
        used = used_today(user)
        active = download_slots.active(user["id"])
        if active >= MAX_CONCURRENT_DOWNLOADS_PER_USER:
            raise DownloadRefused(
                "busy",
                f"You already have {active} downloads in progress. "
                "Wait for one to finish, then try again.",
            )
        if limit is not None and used + active >= limit:
            raise DownloadRefused("limit", _limit_message(limit, used))
        download_slots.add(user["id"])
    return user, platform, limit


def complete_download(user_id: str) -> int:
    """Count a finished download and release its slot; returns today's count."""
    with user_lock(user_id):
        try:
            return storage.record_user_download(user_id, security.local_today())
        finally:
            download_slots.release(user_id)


def release_download(user_id: str) -> None:
    """Free the slot of a download that failed or was abandoned (not counted).

    No account lock is needed: nothing is counted, so a start that runs
    concurrently is right whether it sees the slot or not. That keeps this
    safe to call on the event loop.
    """
    download_slots.release(user_id)
