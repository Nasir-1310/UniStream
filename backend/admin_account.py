# backend/admin_account.py
"""The single admin account, and require_admin for every /admin route.

The account is two rows in app_settings: `admin_username` and
`admin_password_hash` (scrypt, like user passwords). There is no separate
table, so the v2 migration is all the database needs.

Bootstrap mode: until a password has been saved (or while
ADMIN_RESET_PASSWORD=true, or while the settings table does not exist yet
because the migration has not been run), the owner signs in with the
username (ADMIN_USERNAME, default "admin") and ADMIN_PASSWORD, or
ADMIN_SECRET when ADMIN_PASSWORD is unset. Such a session reports
must_change_password, and the dashboard asks for a real username and
password before anything else. Reading the settings defensively matters:
the owner must always be able to reach the dashboard to copy the migration
SQL.

Sessions are signed tokens (purpose "admin", 12 hours or 7 days) bound to a
fingerprint of the password they were opened with, so changing the admin
password ends every other admin session. ADMIN_SECRET also keeps working as
an API key in the x-admin-secret header, for scripts.
"""

import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Header, HTTPException, Request

import security
import storage
from dependencies import bearer_token, hash_password, too_many_requests, verify_password


logger = logging.getLogger(__name__)

USERNAME_KEY = "admin_username"
PASSWORD_HASH_KEY = "admin_password_hash"
DEFAULT_USERNAME = "admin"
TOKEN_SUBJECT = "admin"
TOKEN_PURPOSE = "admin"
SESSION_TTL_SECONDS = 12 * 3600
REMEMBER_TTL_SECONDS = 7 * 24 * 3600

SESSION_EXPIRED_MESSAGE = "Admin session expired. Please sign in again."
NOT_CONFIGURED_MESSAGE = "Admin access is not configured. Set ADMIN_SECRET on the server."

# Wrong x-admin-secret values allowed per client IP and window.
API_KEY_FAILURES_PER_IP = (10, 15 * 60)

_TRUE = {"1", "true", "yes", "on"}


# ── Configuration (read at call time, so tests and redeploys take effect) ─────

def api_key() -> str:
    """ADMIN_SECRET: the x-admin-secret API key ("" = API key disabled)."""
    return os.getenv("ADMIN_SECRET", "").strip()


def bootstrap_password() -> str:
    """The password that opens bootstrap mode: ADMIN_PASSWORD, else ADMIN_SECRET."""
    return os.getenv("ADMIN_PASSWORD", "").strip() or api_key()


def recovery_mode() -> bool:
    """ADMIN_RESET_PASSWORD=true: the bootstrap password works again (forgotten password)."""
    return os.getenv("ADMIN_RESET_PASSWORD", "").strip().lower() in _TRUE


def default_username() -> str:
    raw = os.getenv("ADMIN_USERNAME", "").strip()
    if not raw:
        return DEFAULT_USERNAME
    try:
        return security.validate_admin_username(raw)
    except ValueError:
        logger.warning("ADMIN_USERNAME is not a valid username; using %r.", DEFAULT_USERNAME)
        return DEFAULT_USERNAME


# ── Stored account ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class AdminState:
    username: str
    password_hash: str | None
    recovery: bool
    bootstrap_secret: str
    # False when the settings could not be read (migration not run, or the
    # database is unreachable); credentials cannot be saved then.
    settings_available: bool

    @property
    def bootstrap(self) -> bool:
        """The bootstrap password is accepted (no saved password, or recovery)."""
        return bool(self.bootstrap_secret) and (self.password_hash is None or self.recovery)

    @property
    def password_pv(self) -> str | None:
        return security.password_version(self.password_hash) if self.password_hash else None

    @property
    def bootstrap_pv(self) -> str | None:
        if not self.bootstrap:
            return None
        return security.bootstrap_version(self.bootstrap_secret, self.password_hash)

    @property
    def configured(self) -> bool:
        return bool(self.password_hash) or bool(self.bootstrap_secret)

    def accepts(self, pv: str) -> bool:
        """Whether a session opened under password version `pv` is still valid."""
        valid = False
        for current in (self.password_pv, self.bootstrap_pv):
            if current and security.secret_matches(pv, current):
                valid = True
        return valid

    def is_bootstrap_session(self, pv: str) -> bool:
        current = self.bootstrap_pv
        return bool(current) and security.secret_matches(pv, current)


# Last values read from the database, for when it is briefly unreachable:
# admin sessions keep working (e.g. to open the System page and see why).
_last_known: tuple[str | None, str | None] | None = None
_last_known_lock = threading.Lock()
# Serialises credential changes within this process.
_change_lock = threading.Lock()


def _remember(username: str | None, password_hash: str | None) -> None:
    global _last_known
    with _last_known_lock:
        _last_known = (username, password_hash)


def forget_cached_state() -> None:
    """Drop the last-known credentials (tests)."""
    global _last_known
    with _last_known_lock:
        _last_known = None


def load_state() -> AdminState:
    """The admin account as stored, with bootstrap/recovery rules applied."""
    available = True
    try:
        stored_username = storage.get_setting(USERNAME_KEY)
        stored_hash = storage.get_setting(PASSWORD_HASH_KEY)
        _remember(stored_username, stored_hash)
    except storage.SchemaOutdatedError:
        # No app_settings table yet: bootstrap, so the owner can sign in and
        # copy the migration SQL.
        stored_username = stored_hash = None
        available = False
    except storage.StorageUnavailableError as exc:
        logger.warning("Admin settings unavailable, using the last known values: %s", exc)
        with _last_known_lock:
            stored_username, stored_hash = _last_known or (None, None)
        available = False

    if stored_hash and not security.is_password_hash(stored_hash):
        # A damaged value can never match a password; treating it as unset
        # keeps the bootstrap password working instead of locking the owner out.
        logger.warning("Stored admin password hash is malformed; using the bootstrap password.")
        stored_hash = None

    username = default_username()
    if stored_username:
        try:
            username = security.validate_admin_username(stored_username)
        except ValueError:
            logger.warning("Stored admin username is invalid; using %r.", username)
    return AdminState(
        username=username,
        password_hash=stored_hash or None,
        recovery=recovery_mode(),
        bootstrap_secret=bootstrap_password(),
        settings_available=available,
    )


def admin_configured(state: AdminState | None = None) -> bool:
    """Some way to sign in exists. Avoids the database when an env secret is set."""
    if api_key() or bootstrap_password():
        return True
    return (state or load_state()).configured


# ── Sessions ──────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class AdminSession:
    token: str
    username: str
    must_change_password: bool
    expires_at: str

    def as_json(self) -> dict:
        return {
            "token": self.token,
            "username": self.username,
            "must_change_password": self.must_change_password,
            "expires_at": self.expires_at,
        }


def issue_session(state: AdminState, pv: str, *, remember: bool) -> AdminSession:
    ttl = REMEMBER_TTL_SECONDS if remember else SESSION_TTL_SECONDS
    token = security.create_token(TOKEN_SUBJECT, pv, TOKEN_PURPOSE, ttl)
    payload = security.verify_token(token, TOKEN_PURPOSE)
    expires_at = datetime.fromtimestamp(payload["exp"], tz=timezone.utc).isoformat()
    return AdminSession(
        token=token,
        username=state.username,
        must_change_password=state.is_bootstrap_session(pv),
        expires_at=expires_at,
    )


def authenticate(username: str, password: str, *, remember: bool) -> AdminSession | None:
    """A new admin session for correct credentials, else None.

    Costs one scrypt run whichever way it fails (wrong username, wrong
    password, bootstrap or saved password), so timing reveals nothing.
    """
    state = load_state()
    name = (username or "").strip().lower()
    password = password or ""
    stored_ok = verify_password(password, state.password_hash)  # decoy run when None
    if state.password_hash and stored_ok and security.secret_matches(name, state.username):
        return issue_session(state, state.password_pv, remember=remember)
    if state.bootstrap and security.secret_matches(password, state.bootstrap_secret):
        # In recovery the owner may not remember a changed username either.
        names = {state.username, default_username()}
        if any(security.secret_matches(name, candidate) for candidate in names):
            return issue_session(state, state.bootstrap_pv, remember=remember)
    return None


def current_password_matches(state: AdminState, password: str) -> bool:
    """For change-credentials: the saved password, or the bootstrap one while it is accepted."""
    stored_ok = verify_password(password, state.password_hash)
    if state.password_hash and stored_ok:
        return True
    return state.bootstrap and security.secret_matches(password, state.bootstrap_secret)


def save_credentials(username: str, new_password: str) -> AdminState:
    """Store a new username and password hash together; ends every other admin session.

    Raises storage.SchemaOutdatedError before the migration has been run, or
    storage.StorageUnavailableError when the database is unreachable.
    """
    new_hash = hash_password(new_password)
    with _change_lock:
        storage.set_settings({USERNAME_KEY: username, PASSWORD_HASH_KEY: new_hash})
        _remember(username, new_hash)
    return load_state()


# ── Guard ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class AdminIdentity:
    """Who passed require_admin: a dashboard session or the API key."""

    via: str  # "session" | "api_key"
    state: AdminState
    payload: dict | None = None  # the session token's claims

    @property
    def must_change_password(self) -> bool:
        if self.via == "session" and self.payload is not None:
            return self.state.is_bootstrap_session(self.payload["pv"])
        return self.state.password_hash is None

    @property
    def remembered(self) -> bool:
        """The session was opened with "Keep me signed in"."""
        if not self.payload:
            return False
        return self.payload["exp"] - self.payload["iat"] > SESSION_TTL_SECONDS


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401, detail=SESSION_EXPIRED_MESSAGE, headers={"WWW-Authenticate": "Bearer"},
    )


def _first_time_wrong_key(ip: str, given: str) -> bool:
    """True the first time this IP sends this wrong key in the window.

    A script or old tab holding a rotated key repeats the same wrong value;
    counting each would lock the owner out of their own IP. Repeating one
    wrong value teaches a guesser nothing, so only distinct guesses count.
    """
    fingerprint = security.password_version(given)
    _limit, window = API_KEY_FAILURES_PER_IP
    first, _retry = security.rate_limiter.hit(
        "admin_key_guesses", f"{ip}|{fingerprint}", 1, window,
    )
    return first


def _api_key_identity(request: Request, given: str) -> AdminIdentity | None:
    ip = security.client_ip(request)
    limit, window = API_KEY_FAILURES_PER_IP
    allowed, retry_after = security.rate_limiter.check("admin_key_failures", ip, limit, window)
    if not allowed:
        raise too_many_requests(
            "Too many failed admin sign-in attempts. Try again in {wait}.", retry_after,
        )
    key = api_key()
    if key and security.secret_matches(given, key):
        return AdminIdentity(via="api_key", state=load_state())
    if _first_time_wrong_key(ip, given):
        security.rate_limiter.hit("admin_key_failures", ip, limit, window)
    return None


def require_admin(
    request: Request,
    authorization: str | None = Header(None),
    x_admin_secret: str | None = Header(None),
) -> AdminIdentity:
    """FastAPI dependency for every /admin route (except /admin/auth/login).

    Accepts an admin session (Authorization: Bearer) or the ADMIN_SECRET API
    key (x-admin-secret). User session tokens and download tickets are
    refused: tokens carry a purpose.
    """
    token = bearer_token(authorization)
    if token:
        payload = security.verify_token(token, TOKEN_PURPOSE)
        if payload is not None and payload["sub"] == TOKEN_SUBJECT:
            state = load_state()
            if state.accepts(payload["pv"]):
                return AdminIdentity(via="session", state=state, payload=payload)

    given = (x_admin_secret or "").strip()
    if given:
        identity = _api_key_identity(request, given)
        if identity is not None:
            return identity

    if not admin_configured():
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED_MESSAGE)
    raise _unauthorized()
