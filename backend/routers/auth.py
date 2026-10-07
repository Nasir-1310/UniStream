# backend/routers/auth.py
"""Account endpoints: request access, sign in, password reset and change.

Accounts are created as "pending" and only an admin approves them; the
approval emails a temporary password (routers/admin.py). Sessions are signed
tokens bound to the account's password version, so any password change ends
every older session.

Brute-force and enumeration rules:
  * sign-in failures are limited per client IP and every attempt per login;
  * unknown accounts still cost one password hash, so timing reveals nothing;
  * forgot-password always answers the same way, and the email (if any) is
    sent after the response so its latency cannot be measured either.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator

import email_service
import security
import storage
from dependencies import (
    SESSION_EXPIRED_MESSAGE,
    clean_note,
    hash_password,
    issue_session,
    public_user,
    require_user,
    status_error,
    too_many_requests,
    user_lock,
    verify_password,
)


router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

INVALID_LOGIN_MESSAGE = "Incorrect email/phone or password."
NO_PASSWORD_MESSAGE = "Your account has no password yet. Use “Forgot password” to set one."
FORGOT_MESSAGE = (
    "If an approved account uses this email, a reset link is on its way. "
    "Check your inbox and spam folder."
)
INVALID_RESET_MESSAGE = "This reset link is invalid or has expired. Request a new one."
DUPLICATE_MESSAGES = {
    "email": "This email is already registered. Sign in or reset your password.",
    "phone": "This phone number is already registered. Sign in or reset your password.",
}

# (limit, window seconds). The service launches at a university: a whole
# campus Wi-Fi (or a mobile carrier's CGNAT) can share one public IP, so the
# per-IP limits only stop floods, sized for a class signing up or mistyping
# a temporary password at the same time. Sign-in failures are counted per IP
# rather than every attempt; every attempt counts per login, which is what
# stops password guessing.
REGISTER_PER_IP = (20, 3600)
LOGIN_FAILURES_PER_IP = (30, 15 * 60)
LOGIN_ATTEMPTS_PER_LOGIN = (10, 15 * 60)
FORGOT_PER_IP = (10, 3600)
FORGOT_PER_EMAIL = (3, 3600)
CHANGE_PASSWORD_FAILURES = (10, 15 * 60)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Request bodies ────────────────────────────────────────────────────────────
# Field validators reuse security.py so the API and the frontend (which
# mirrors these messages) reject the same input with the same words.

class RegisterRequest(BaseModel):
    name: str
    email: str
    phone: str
    note: Optional[str] = None

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
        return clean_note(value, label="Institution / department", max_length=120)


class LoginRequest(BaseModel):
    login: str
    password: str

    @field_validator("login", mode="before")
    @classmethod
    def _login(cls, value):
        return security.classify_login(value)

    @field_validator("password", mode="before")
    @classmethod
    def _password(cls, value):
        # Only presence is checked: temporary and older passwords must still work.
        if not isinstance(value, str) or not value:
            raise ValueError("Please enter your password.")
        return value


class ForgotPasswordRequest(BaseModel):
    email: str

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, value):
        return security.validate_email(value)


class ResetPasswordRequest(BaseModel):
    token: str
    password: str

    @field_validator("token", mode="before")
    @classmethod
    def _token(cls, value):
        if not isinstance(value, str) or not value.strip():
            raise ValueError(INVALID_RESET_MESSAGE)
        return value.strip()

    @field_validator("password", mode="before")
    @classmethod
    def _password(cls, value):
        return security.validate_password(value)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("current_password", mode="before")
    @classmethod
    def _current(cls, value):
        if not isinstance(value, str) or not value:
            raise ValueError("Please enter your current password.")
        return value

    @field_validator("new_password", mode="before")
    @classmethod
    def _new(cls, value):
        return security.validate_password(value)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _limit(bucket: str, key: str, rule: tuple[int, int], message: str, *, record: bool = True) -> None:
    """Raise 429 when `key` is over `rule`; with record=False nothing is counted."""
    limit, window = rule
    check = security.rate_limiter.hit if record else security.rate_limiter.check
    allowed, retry_after = check(bucket, key, limit, window)
    if not allowed:
        raise too_many_requests(message, retry_after)


def _forget_login_failures(user: dict) -> None:
    """A new password starts with a clean slate for every way of signing in."""
    for value in {user.get("email"), user.get("phone"), user.get("identifier")}:
        if value:
            security.rate_limiter.clear("login_attempts", value)


def _session_response(user: dict, message: str | None = None) -> dict:
    body = {"token": issue_session(user), "user": public_user(user)}
    if message:
        body = {"message": message, **body}
    return body


def _reset_address(user: dict) -> str | None:
    """Where an account's reset link may go: its email (legacy rows: an email identifier)."""
    if user.get("email"):
        return user["email"]
    identifier = user.get("identifier") or ""
    return identifier if "@" in identifier else None


def _send_reset_link(email: str) -> None:
    """Background task: email a reset link if an approved account uses `email`.

    Every failure is only logged: the caller has already answered, and the
    answer must not depend on whether the account exists.
    """
    try:
        user = storage.get_user_by_login(email)
        if not user or user.get("status") != "approved" or _reset_address(user) != email:
            return
        token = security.create_token(
            user["id"],
            security.password_version(user.get("password_hash")),
            "reset",
            security.RESET_TTL_SECONDS,
        )
        email_service.send_password_reset_email(
            to=email,
            name=user.get("name") or "",
            reset_url=f"{email_service.app_url()}/reset-password?token={quote(token)}",
        )
    except Exception as exc:  # noqa: BLE001 - logged, never shown to the requester
        logger.warning("Password reset email was not sent: %s: %s", type(exc).__name__, exc)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", status_code=201)
def register(body: RegisterRequest, request: Request):
    """Request access: creates a pending account for the admin to approve."""
    _limit(
        "register_ip", security.client_ip(request), REGISTER_PER_IP,
        "Too many sign-up requests from your network. Try again in {wait}.",
    )
    conflict = storage.find_conflicts(body.email, body.phone)
    if conflict:
        raise HTTPException(status_code=409, detail=DUPLICATE_MESSAGES[conflict])
    try:
        storage.create_user(
            name=body.name, email=body.email, phone=body.phone, note=body.note, status="pending",
        )
    except storage.DuplicateUserError as exc:
        raise HTTPException(status_code=409, detail=DUPLICATE_MESSAGES[exc.field]) from None
    return {
        "message": (
            "Request received. An administrator will review it, and you'll get "
            "your password by email once it's approved."
        ),
    }


@router.post("/login")
def login(body: LoginRequest, request: Request):
    ip = security.client_ip(request)
    _limit(
        "login_ip_failures", ip, LOGIN_FAILURES_PER_IP,
        "Too many failed sign-in attempts from your network. Try again in {wait}.",
        record=False,
    )
    _limit(
        "login_attempts", body.login, LOGIN_ATTEMPTS_PER_LOGIN,
        "Too many sign-in attempts for this account. Try again in {wait}, "
        "or reset your password.",
    )

    user = storage.get_user_by_login(body.login)
    stored_hash = user.get("password_hash") if user else None
    # Runs a decoy hash when there is no account, so both cases cost the same.
    password_ok = verify_password(body.password, stored_hash)

    failure: HTTPException | None = None
    if user is None:
        failure = HTTPException(status_code=401, detail=INVALID_LOGIN_MESSAGE)
    elif user.get("status") == "approved":
        if not stored_hash:
            failure = HTTPException(status_code=403, detail=NO_PASSWORD_MESSAGE)
        elif not password_ok:
            failure = HTTPException(status_code=401, detail=INVALID_LOGIN_MESSAGE)
    elif user.get("status") == "blocked" and stored_hash and not password_ok:
        # A blocked account's status is only revealed to its password holder.
        failure = HTTPException(status_code=401, detail=INVALID_LOGIN_MESSAGE)
    else:
        failure = status_error(user)

    if failure is not None:
        limit, window = LOGIN_FAILURES_PER_IP
        security.rate_limiter.hit("login_ip_failures", ip, limit, window)
        raise failure

    security.rate_limiter.clear("login_attempts", body.login)
    user = storage.update_user(user["id"], {"last_login_at": _now()}) or user
    return _session_response(user)


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest, request: Request, background: BackgroundTasks):
    _limit(
        "forgot_ip", security.client_ip(request), FORGOT_PER_IP,
        "Too many password reset requests. Try again in {wait}.",
    )
    limit, window = FORGOT_PER_EMAIL
    allowed, _retry = security.rate_limiter.hit("forgot_email", body.email, limit, window)
    # Over the per-email limit the answer is unchanged, so it reveals nothing.
    if allowed:
        background.add_task(_send_reset_link, body.email)
    return {"message": FORGOT_MESSAGE}


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest):
    """Set a new password from an emailed link, and sign in.

    The token carries the password version it was issued for, so it stops
    working once any password is set: links are single-use.
    """
    payload = security.verify_token(body.token, "reset")
    if payload is None:
        raise HTTPException(status_code=400, detail=INVALID_RESET_MESSAGE)
    new_hash = hash_password(body.password)

    with user_lock(payload["sub"]):
        user = storage.get_user_by_id(payload["sub"])
        if user is None or payload["pv"] != security.password_version(user.get("password_hash")):
            raise HTTPException(status_code=400, detail=INVALID_RESET_MESSAGE)
        error = status_error(user)
        if error is not None:
            raise error
        user = storage.update_user(user["id"], {
            "password_hash": new_hash,
            "temp_password": False,
            "last_login_at": _now(),
        })
    if user is None:
        raise HTTPException(status_code=400, detail=INVALID_RESET_MESSAGE)
    _forget_login_failures(user)
    return _session_response(user, "Your password has been reset. You're now signed in.")


@router.get("/me")
def me(user: dict = Depends(require_user)):
    return {"user": public_user(user)}


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, user: dict = Depends(require_user)):
    message = "Too many incorrect passwords. Try again in {wait}."
    _limit("change_password_failures", user["id"], CHANGE_PASSWORD_FAILURES, message, record=False)
    if not verify_password(body.current_password, user.get("password_hash")):
        _limit("change_password_failures", user["id"], CHANGE_PASSWORD_FAILURES, message)
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=400,
            detail="Your new password must be different from your current password.",
        )
    new_hash = hash_password(body.new_password)

    with user_lock(user["id"]):
        current = storage.get_user_by_id(user["id"])
        # Another device changed the password meanwhile: this session is over.
        if current is None or current.get("password_hash") != user.get("password_hash"):
            raise HTTPException(
                status_code=401, detail=SESSION_EXPIRED_MESSAGE,
                headers={"WWW-Authenticate": "Bearer"},
            )
        updated = storage.update_user(user["id"], {"password_hash": new_hash, "temp_password": False})
    if updated is None:
        raise HTTPException(status_code=401, detail=SESSION_EXPIRED_MESSAGE)
    _forget_login_failures(updated)
    return _session_response(
        updated, "Your password has been changed. Other devices have been signed out.",
    )
