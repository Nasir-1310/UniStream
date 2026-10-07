# backend/routers/admin_auth.py
"""Admin sign-in: POST /admin/auth/login, GET /admin/auth/me and
POST /admin/auth/change-credentials (see admin_account.py for the rules).

Kept apart from routers/admin.py because that router requires an admin on
every route, and signing in is how an admin gets there.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, field_validator

import admin_account
import security
import storage
from admin_account import AdminIdentity, require_admin
from dependencies import auth_ip_cap, capped, limit_rule


router = APIRouter(prefix="/admin/auth", tags=["admin"], dependencies=[Depends(auth_ip_cap)])
logger = logging.getLogger(__name__)

INVALID_LOGIN_MESSAGE = "Incorrect username or password."
WRONG_CURRENT_MESSAGE = "Your current password is incorrect."
SCHEMA_REQUIRED_MESSAGE = (
    "Your new admin password can't be saved until the database upgrade has been run. "
    "Open System, copy the upgrade SQL into the Supabase SQL editor and run it, then try again."
)

# (limit, window seconds). Failures count per client IP; every attempt counts
# per username (cleared by a successful sign-in), which is what stops guessing.
LOGIN_FAILURES_PER_IP = (5, 15 * 60)
LOGIN_ATTEMPTS_PER_USERNAME = (5, 15 * 60)
CHANGE_FAILURES = (5, 15 * 60)
LOCKED_MESSAGE = "Too many sign-in attempts. Try again in {wait}."

# Bootstrap passwords are environment secrets, which can be longer than the
# 128 characters allowed for passwords chosen in the dashboard.
LOGIN_PASSWORD_MAX = 256
LOGIN_USERNAME_MAX = 64


class AdminLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str
    remember: bool = False

    @field_validator("username", mode="before")
    @classmethod
    def _username(cls, value):
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Please enter your username.")
        return capped(value, LOGIN_USERNAME_MAX, "Username").strip().lower()

    @field_validator("password", mode="before")
    @classmethod
    def _password(cls, value):
        if not isinstance(value, str) or not value:
            raise ValueError("Please enter your password.")
        if len(value) > LOGIN_PASSWORD_MAX:
            raise ValueError(f"Password must be at most {LOGIN_PASSWORD_MAX} characters.")
        return value


class ChangeCredentialsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str
    new_password: str
    new_username: Optional[str] = None

    @field_validator("current_password", mode="before")
    @classmethod
    def _current(cls, value):
        if not isinstance(value, str) or not value:
            raise ValueError("Please enter your current password.")
        if len(value) > LOGIN_PASSWORD_MAX:
            raise ValueError(WRONG_CURRENT_MESSAGE)
        return value

    @field_validator("new_password", mode="before")
    @classmethod
    def _new(cls, value):
        return security.validate_admin_password(value)

    @field_validator("new_username", mode="before")
    @classmethod
    def _new_username(cls, value):
        # Empty means "keep the current username".
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        return security.validate_admin_username(capped(value, LOGIN_USERNAME_MAX, "Username"))


@router.post("/login")
def login(body: AdminLoginRequest, request: Request):
    """Sign in to the dashboard: {"token","username","must_change_password","expires_at"}."""
    ip = security.client_ip(request)
    limit_rule("admin_login_ip_failures", ip, LOGIN_FAILURES_PER_IP, LOCKED_MESSAGE, record=False)
    # Counted for every username, existing or not, so a lockout reveals nothing.
    limit_rule("admin_login_attempts", body.username, LOGIN_ATTEMPTS_PER_USERNAME, LOCKED_MESSAGE)
    if not admin_account.admin_configured():
        raise HTTPException(status_code=503, detail=admin_account.NOT_CONFIGURED_MESSAGE)

    session = admin_account.authenticate(body.username, body.password, remember=body.remember)
    if session is None:
        limit, window = LOGIN_FAILURES_PER_IP
        security.rate_limiter.hit("admin_login_ip_failures", ip, limit, window)
        raise HTTPException(status_code=401, detail=INVALID_LOGIN_MESSAGE)

    security.rate_limiter.clear("admin_login_attempts", body.username)
    if session.must_change_password:
        logger.info("Admin signed in with the bootstrap password")
    return session.as_json()


@router.get("/me")
def me(identity: AdminIdentity = Depends(require_admin)):
    return {
        "username": identity.state.username,
        "must_change_password": identity.must_change_password,
        "recovery_mode": identity.state.recovery,
    }


@router.post("/change-credentials")
def change_credentials(body: ChangeCredentialsRequest, identity: AdminIdentity = Depends(require_admin)):
    """Set a new admin password (and optionally username); other admin sessions end."""
    if identity.via != "session":
        raise HTTPException(
            status_code=403,
            detail="Sign in to the dashboard with your admin username and password to change them.",
        )
    message = "Too many incorrect passwords. Try again in {wait}."
    limit_rule("admin_change_failures", "admin", CHANGE_FAILURES, message, record=False)

    state = admin_account.load_state()
    if not admin_account.current_password_matches(state, body.current_password):
        limit_rule("admin_change_failures", "admin", CHANGE_FAILURES, message)
        raise HTTPException(status_code=400, detail=WRONG_CURRENT_MESSAGE)
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=400,
            detail="Your new password must be different from your current password.",
        )
    env_secrets = (admin_account.api_key(), admin_account.bootstrap_password())
    if any(security.secret_matches(body.new_password, secret) for secret in env_secrets):
        raise HTTPException(
            status_code=400,
            detail="Choose a new password that is different from ADMIN_SECRET and ADMIN_PASSWORD.",
        )

    username = body.new_username or state.username
    try:
        new_state = admin_account.save_credentials(username, body.new_password)
    except storage.SchemaOutdatedError:
        raise HTTPException(status_code=503, detail=SCHEMA_REQUIRED_MESSAGE) from None
    except storage.StorageUnavailableError as exc:
        logger.warning("Admin credentials were not saved: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="The database isn't responding right now, so nothing was changed. "
            "Please try again in a minute.",
            headers={"Retry-After": "5"},
        ) from None

    security.rate_limiter.clear("admin_change_failures", "admin")
    for name in {state.username, username}:
        security.rate_limiter.clear("admin_login_attempts", name)
    logger.info("Admin credentials changed")
    session = admin_account.issue_session(
        new_state, new_state.password_pv, remember=identity.remembered,
    )
    return session.as_json()
