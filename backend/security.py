"""Validation, password hashing, signed tokens, rate limiting and platform rules.

Pure helpers with no storage imports, so they can be unit-tested in isolation
and reused by every router. Everything that depends on configuration reads the
environment at call time (after python-dotenv has loaded backend/.env), which
also lets tests patch os.environ.
"""

import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import math
import os
import re
import secrets
import threading
import time
import unicodedata
from collections import OrderedDict, deque
from datetime import date, datetime, time as dt_time, timedelta, timezone, tzinfo
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv


backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

logger = logging.getLogger(__name__)


# ── Field validation ──────────────────────────────────────────────────────────
# Messages are shown to users verbatim (the frontend displays `detail`), and
# frontend/lib/validation.ts mirrors them, so keep both in sync.

NAME_MIN, NAME_MAX = 2, 80
EMAIL_MAX = 254
PASSWORD_MIN, PASSWORD_MAX = 8, 128

# Same shape as the frontend's EMAIL_RE: an alphanumeric first character, a
# dotted domain of valid labels and an alphabetic TLD.
_EMAIL_RE = re.compile(
    r"^[a-z0-9][a-z0-9._%+\-]{0,63}"
    r"@[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)*"
    r"\.[a-z]{2,24}$"
)
# Separators people type in phone numbers; NBSP arrives from copy-paste.
_PHONE_SEPARATORS_RE = re.compile(r"[\s\-(). ]")


# Bidi overrides/isolates can make a name render as different text in the admin
# panel and emails. Other format characters stay allowed: Bengali spelling
# needs the zero-width (non-)joiner.
_BIDI_CONTROLS = frozenset("‪‫‬‭‮⁦⁧⁨⁩")


def _has_control_chars(value: str) -> bool:
    return any(unicodedata.category(ch) == "Cc" or ch in _BIDI_CONTROLS for ch in value)


def validate_name(s) -> str:
    """Return the trimmed full name (inner whitespace collapsed) or raise ValueError."""
    if not isinstance(s, str):
        raise ValueError("Please enter your full name.")
    name = " ".join(s.split())
    if not name:
        raise ValueError("Please enter your full name.")
    if _has_control_chars(name):
        raise ValueError("Name contains invalid characters.")
    if len(name) < NAME_MIN:
        raise ValueError(f"Name must be at least {NAME_MIN} characters.")
    if len(name) > NAME_MAX:
        raise ValueError(f"Name must be at most {NAME_MAX} characters.")
    # isalpha() accepts Bengali and other scripts, not just A-Z.
    if not any(ch.isalpha() for ch in name):
        raise ValueError("Name must contain letters.")
    return name


def validate_email(s) -> str:
    """Return the lowercased email address or raise ValueError with a specific hint."""
    if not isinstance(s, str) or not s.strip():
        raise ValueError("Please enter your email address.")
    email = s.strip().lower()
    if any(ch.isspace() for ch in email):
        raise ValueError("Email can't contain spaces.")
    if len(email) > EMAIL_MAX:
        raise ValueError("Email is too long.")
    if "@" not in email:
        raise ValueError("Enter a valid email address, e.g. name@gmail.com.")
    local, _, domain = email.partition("@")
    if "@" in domain:
        raise ValueError("Only one @ symbol allowed.")
    if not local:
        raise ValueError("Enter a username before @.")
    if "." not in domain:
        raise ValueError("Missing domain — e.g. @gmail.com")
    # The regex alone allows "a..b@" and "a.@"; mail providers reject both.
    if ".." in email or local.endswith(".") or not _EMAIL_RE.match(email):
        raise ValueError("Invalid email — check the format.")
    return email


def validate_phone(s) -> str:
    """Return the number in E.164 form or raise ValueError with a specific hint.

    Bangladeshi mobiles are accepted as 01XXXXXXXXX, 8801XXXXXXXXX or
    +8801XXXXXXXXX (spaces, dashes, dots and brackets ignored); numbers from
    other countries must carry their country code: +<7 to 15 digits>.
    """
    if not isinstance(s, str) or not s.strip():
        raise ValueError("Please enter your phone number.")
    compact = _PHONE_SEPARATORS_RE.sub("", s.strip())
    if compact.startswith("00"):  # international dialling prefix
        compact = "+" + compact[2:]
    if not re.fullmatch(r"\+?\d+", compact):
        raise ValueError(
            "Phone number can only contain digits, spaces, dashes and a leading +."
        )

    has_plus = compact.startswith("+")
    digits = compact.lstrip("+")

    if has_plus and not digits.startswith("880"):
        if digits.startswith("0"):
            raise ValueError(
                "Invalid country code — write international numbers as "
                "+<country code><number>."
            )
        if len(digits) < 7:
            raise ValueError("Too short — international numbers need 7 to 15 digits after the +.")
        if len(digits) > 15:
            raise ValueError("Too long — international numbers have at most 15 digits after the +.")
        return "+" + digits

    if digits.startswith("880"):
        rest = digits[3:]
        # Accept both +880 1XXXXXXXXX (E.164) and the common +880 01XXXXXXXXX.
        national = rest if rest.startswith("0") else "0" + rest
    else:
        national = digits

    if len(national) < 11:
        raise ValueError("Too short — Bangladeshi numbers need 11 digits, e.g. 017XXXXXXXX.")
    if len(national) > 11:
        raise ValueError("Too long — Bangladeshi numbers have 11 digits, e.g. 017XXXXXXXX.")
    if not national.startswith("01"):
        raise ValueError(
            "Must start with 01, e.g. 017XXXXXXXX. For numbers outside "
            "Bangladesh, add the country code, e.g. +44…"
        )
    if national[2] not in "3456789":
        raise ValueError("Unknown operator — Bangladeshi mobile numbers start with 013–019.")
    return "+880" + national[1:]


def classify_login(s) -> str:
    """Normalise a sign-in value: the email when it contains '@', else the phone."""
    if not isinstance(s, str) or not s.strip():
        raise ValueError("Enter your email address or phone number.")
    value = s.strip()
    if "@" in value:
        return validate_email(value)
    if not re.match(r"[\d+(]", value):
        raise ValueError("Enter a valid email address or phone number.")
    return validate_phone(value)


def validate_password(s) -> str:
    """Return the password unchanged (spaces are allowed) or raise ValueError."""
    if not isinstance(s, str) or not s:
        raise ValueError("Please enter a password.")
    if len(s) < PASSWORD_MIN:
        raise ValueError(f"Password must be at least {PASSWORD_MIN} characters.")
    if len(s) > PASSWORD_MAX:
        raise ValueError(f"Password must be at most {PASSWORD_MAX} characters.")
    if not any(ch.isalpha() for ch in s) or not any(ch.isdigit() for ch in s):
        raise ValueError("Password must include at least one letter and one number.")
    return s


# ── Passwords ─────────────────────────────────────────────────────────────────
# scrypt is memory-hard and ships with hashlib, so no extra dependency is
# needed. n=2**14 costs ~50 ms and 16 MiB per check: cheap for ~1000 users,
# expensive for offline guessing.

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _SCRYPT_DKLEN = 2**14, 8, 1, 32
_SCRYPT_MAXMEM = 64 * 1024 * 1024
# Fixed salt for the decoy hash computed when there is nothing to compare
# against, so "no such user" costs as much as "wrong password".
_DECOY_SALT = b"unistream-decoy!"


def _password_bytes(pw: str) -> bytes:
    # NFKC so the same password typed on different keyboards/OSes (composed vs
    # decomposed characters) hashes identically.
    return unicodedata.normalize("NFKC", pw).encode("utf-8")


def _scrypt(pw: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(
        _password_bytes(pw), salt=salt, n=n, r=r, p=p, dklen=dklen, maxmem=_SCRYPT_MAXMEM,
    )


def hash_password(pw: str) -> str:
    """Return "scrypt$16384$8$1$<salt b64>$<hash b64>" for storage."""
    if not isinstance(pw, str) or not pw:
        raise ValueError("Password must be a non-empty string.")
    salt = secrets.token_bytes(16)
    digest = _scrypt(pw, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _SCRYPT_DKLEN)
    return "$".join((
        "scrypt", str(_SCRYPT_N), str(_SCRYPT_R), str(_SCRYPT_P),
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    ))


def _parse_hash(stored) -> tuple[int, int, int, bytes, bytes] | None:
    if not isinstance(stored, str):
        return None
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return None
    try:
        n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
        salt = base64.b64decode(parts[4], validate=True)
        digest = base64.b64decode(parts[5], validate=True)
    except (ValueError, TypeError):
        return None
    # Bound the work factors so a corrupted row cannot stall the worker.
    if not (2 <= n <= 2**17 and n & (n - 1) == 0 and 1 <= r <= 16 and 1 <= p <= 4):
        return None
    if not salt or not 16 <= len(digest) <= 64:
        return None
    return n, r, p, salt, digest


def verify_password(pw, stored) -> bool:
    """Constant-time check; False for a None/malformed hash or a non-string password.

    A missing or malformed hash still costs one scrypt run, so callers can
    pass `None` for unknown accounts without leaking which accounts exist.
    """
    if not isinstance(pw, str) or not pw or len(pw) > 4 * PASSWORD_MAX:
        return False
    parsed = _parse_hash(stored)
    if parsed is None:
        _scrypt(pw, _DECOY_SALT, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _SCRYPT_DKLEN)
        return False
    n, r, p, salt, expected = parsed
    try:
        actual = _scrypt(pw, salt, n, r, p, len(expected))
    except (ValueError, MemoryError):
        return False
    return hmac.compare_digest(actual, expected)


# No 0/O/o, 1/l/I: the password is read from an email and typed on a phone.
_PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_PW_LOWER = "abcdefghijkmnpqrstuvwxyz"
_PW_DIGITS = "23456789"
_PW_ALPHABET = _PW_UPPER + _PW_LOWER + _PW_DIGITS


def generate_password() -> str:
    """Return a temporary password like "Kx7m-Pq4t-Zr9w" (~68 bits of entropy)."""
    while True:
        chars = [secrets.choice(_PW_ALPHABET) for _ in range(12)]
        if (
            any(c in _PW_UPPER for c in chars)
            and any(c in _PW_LOWER for c in chars)
            and any(c in _PW_DIGITS for c in chars)
        ):
            return "-".join("".join(chars[i:i + 4]) for i in range(0, 12, 4))


def password_version(password_hash: str | None) -> str:
    """Short fingerprint of the stored hash; tokens embed it so any password
    change (user, reset or admin-issued) invalidates every older token."""
    if not password_hash:
        return ""
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()[:16]


# ── Signed tokens ─────────────────────────────────────────────────────────────

SESSION_TTL_SECONDS = 30 * 24 * 3600
RESET_TTL_SECONDS = 3600
_MIN_SECRET_LENGTH = 32
_MAX_TOKEN_LENGTH = 2048
_PURPOSE_RE = re.compile(r"[a-z][a-z0-9_]{0,31}")


def auth_secret_configured() -> bool:
    """True when AUTH_SECRET is set to a strong (>= 32 character) value."""
    return len(os.getenv("AUTH_SECRET", "").strip()) >= _MIN_SECRET_LENGTH


@lru_cache(maxsize=1)
def _auth_secret() -> bytes:
    """Signing key, derived once per process.

    Without a dedicated AUTH_SECRET the key is derived from ADMIN_SECRET and
    SUPABASE_SERVICE_KEY: stable across restarts (sessions survive deploys)
    and unknown to users. Rotating either value then signs everyone out.
    """
    explicit = os.getenv("AUTH_SECRET", "").strip()
    if len(explicit) >= _MIN_SECRET_LENGTH:
        return hashlib.sha256(b"unistream-auth-v1\x00" + explicit.encode("utf-8")).digest()

    admin = os.getenv("ADMIN_SECRET", "").strip()
    service = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if explicit:
        logger.warning(
            "AUTH_SECRET is shorter than %d characters; mixing it with the "
            "fallback key. Set a longer AUTH_SECRET.", _MIN_SECRET_LENGTH,
        )
    if explicit or admin or service:
        material = "\x00".join((explicit, admin, service)).encode("utf-8")
        return hashlib.sha256(b"unistream-auth-fallback-v1\x00" + material).digest()

    logger.warning(
        "AUTH_SECRET, ADMIN_SECRET and SUPABASE_SERVICE_KEY are all unset; "
        "using a random per-process signing key. Every restart signs all users out."
    )
    return secrets.token_bytes(32)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_\-]*", text):
        raise ValueError("not base64url")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload_b64: str) -> bytes:
    return hmac.new(_auth_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()


def create_token(user_id: str, pv: str, purpose: str, ttl_seconds: int) -> str:
    """Return "base64url(json payload).base64url(HMAC-SHA256)".

    The payload is readable by its holder but cannot be altered; it carries
    no secrets (pv is a fingerprint of the hash, not the hash).
    """
    if not isinstance(purpose, str) or not _PURPOSE_RE.fullmatch(purpose):
        raise ValueError("Token purpose must be a short lowercase word.")
    if not isinstance(ttl_seconds, int) or ttl_seconds <= 0:
        raise ValueError("Token lifetime must be a positive number of seconds.")
    if user_id is None or str(user_id) == "":
        raise ValueError("Token subject is required.")
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "pv": pv or "",
        "purpose": purpose,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    payload_b64 = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    return f"{payload_b64}.{_b64url_encode(_sign(payload_b64))}"


def verify_token(token, purpose: str) -> dict | None:
    """Return {"sub","pv","exp","purpose","iat"} or None when the token is
    malformed, forged, expired or issued for a different purpose."""
    if not isinstance(token, str) or not token or len(token) > _MAX_TOKEN_LENGTH:
        return None
    parts = token.strip().split(".")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    payload_b64, sig_b64 = parts
    try:
        signature = _b64url_decode(sig_b64)
        if not payload_b64.isascii():
            return None
        if not hmac.compare_digest(signature, _sign(payload_b64)):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    sub, pv, exp = payload.get("sub"), payload.get("pv"), payload.get("exp")
    iat = payload.get("iat", 0)
    if not isinstance(sub, str) or not sub or not isinstance(pv, str):
        return None
    if not isinstance(exp, int) or isinstance(exp, bool) or not isinstance(iat, int):
        return None
    if payload.get("purpose") != purpose:
        return None
    if exp <= time.time():
        return None
    return {"sub": sub, "pv": pv, "exp": exp, "purpose": purpose, "iat": iat}


# ── Rate limiting ─────────────────────────────────────────────────────────────

class RateLimiter:
    """Thread-safe in-memory sliding-window limiter.

    Single-process by design (one Render instance). Only allowed hits are
    recorded, so a client hammering a closed limit does not extend it. Memory
    is bounded: each key keeps at most `limit` timestamps, idle keys are
    pruned periodically, and each bucket evicts its least recently used keys
    past `max_keys`. Buckets are separate so flooding one (e.g. with spoofed
    IPs) cannot evict another bucket's counters, such as per-login failures.
    """

    def __init__(self, max_keys: int = 20_000, clock=time.monotonic):
        self._lock = threading.Lock()
        self._buckets: dict[str, OrderedDict[str, tuple[int, deque]]] = {}
        self._max_keys = max(1, max_keys)
        self._clock = clock
        self._last_prune = clock()

    @staticmethod
    def _blocked_for(hits: deque, now: float, limit: int, window: int) -> int:
        while hits and hits[0] <= now - window:
            hits.popleft()
        if len(hits) < limit:
            return 0
        return max(1, math.ceil(hits[0] + window - now))

    def _prune(self, now: float) -> None:
        """Drop keys whose newest hit has left its window (at most once a minute)."""
        if now - self._last_prune < 60:
            return
        self._last_prune = now
        for name in list(self._buckets):
            entries = self._buckets[name]
            stale = [
                key for key, (window, hits) in entries.items()
                if not hits or hits[-1] <= now - window
            ]
            for key in stale:
                del entries[key]
            if not entries:
                del self._buckets[name]

    def hit(self, bucket: str, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """Record one attempt. Returns (allowed, retry_after_seconds)."""
        if limit <= 0:
            return False, max(1, int(window_seconds))
        now = self._clock()
        key = str(key)
        with self._lock:
            self._prune(now)
            entries = self._buckets.setdefault(bucket, OrderedDict())
            entry = entries.get(key)
            hits = entry[1] if entry else deque()
            entries[key] = (window_seconds, hits)
            entries.move_to_end(key)
            while len(entries) > self._max_keys:
                entries.popitem(last=False)  # least recently used
            retry_after = self._blocked_for(hits, now, limit, window_seconds)
            if retry_after:
                return False, retry_after
            hits.append(now)
            while len(hits) > limit:
                hits.popleft()
            return True, 0

    def check(self, bucket: str, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """Like hit() but records nothing, e.g. to refuse early once failures
        (recorded with hit()) have reached the limit."""
        if limit <= 0:
            return False, max(1, int(window_seconds))
        now = self._clock()
        with self._lock:
            entry = self._buckets.get(bucket, {}).get(str(key))
            if entry is None:
                return True, 0
            retry_after = self._blocked_for(entry[1], now, limit, window_seconds)
            return (not retry_after), retry_after

    def clear(self, bucket: str, key: str) -> None:
        """Forget one key, e.g. failed logins after a successful sign-in."""
        with self._lock:
            self._buckets.get(bucket, {}).pop(str(key), None)

    def reset(self) -> None:
        """Forget everything (tests)."""
        with self._lock:
            self._buckets.clear()

    def size(self) -> int:
        """Number of tracked keys across all buckets."""
        with self._lock:
            return sum(len(entries) for entries in self._buckets.values())


rate_limiter = RateLimiter()


def _parse_ip(value: str) -> str | None:
    value = value.strip().strip('"')
    if not value or len(value) > 64:
        return None
    if value.startswith("[") and "]" in value:  # "[2001:db8::1]:443"
        value = value[1:value.index("]")]
    elif value.count(":") == 1:  # "203.0.113.7:51234"
        value = value.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def client_ip(request) -> str:
    """Client address for rate limiting: the first valid X-Forwarded-For
    entry (Render and the Next.js /api rewrite both proxy requests), else the
    socket peer."""
    forwarded = request.headers.get("x-forwarded-for") or ""
    for part in forwarded.split(",")[:20]:
        ip = _parse_ip(part)
        if ip:
            return ip
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    return str(host) if host else "unknown"


# ── Supported platforms ───────────────────────────────────────────────────────

PLATFORM_LABELS = {"youtube": "YouTube", "facebook": "Facebook", "instagram": "Instagram"}
UNSUPPORTED_URL_MESSAGE = "Only YouTube, Facebook and Instagram links are supported."

# Registrable domains per platform; any subdomain (www., m., music., web.)
# of these is accepted.
_PLATFORM_DOMAINS = {
    "youtube": ("youtube.com", "youtu.be", "youtube-nocookie.com"),
    "facebook": ("facebook.com", "fb.watch", "fb.com"),
    "instagram": ("instagram.com", "instagr.am"),
}


def detect_platform(url) -> str | None:
    """Return "youtube" | "facebook" | "instagram" for an http(s) link, else None."""
    if not isinstance(url, str):
        return None
    url = url.strip()
    if not url or len(url) > 4096 or any(ch.isspace() or ord(ch) < 32 for ch in url):
        return None
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        return None
    if parts.scheme.lower() not in {"http", "https"} or not host:
        return None
    host = host.rstrip(".").lower()
    for platform, domains in _PLATFORM_DOMAINS.items():
        for domain in domains:
            if host == domain or host.endswith("." + domain):
                return platform
    return None


def ensure_supported_url(url) -> str:
    """Return the platform key or raise ValueError with the user-facing message."""
    platform = detect_platform(url)
    if platform is None:
        raise ValueError(UNSUPPORTED_URL_MESSAGE)
    return platform


def platform_label(platform: str | None) -> str:
    """Display name for a platform key ("youtube" -> "YouTube"); "" when unknown."""
    return PLATFORM_LABELS.get((platform or "").lower(), "")


# ── Local time (daily limits reset at local midnight) ─────────────────────────

DEFAULT_TIMEZONE = "Asia/Dhaka"
# Bangladesh has had no DST since 2009, so a fixed offset is an exact fallback
# when the host has no tz database (Windows without the tzdata package).
_DHAKA_FIXED = timezone(timedelta(hours=6), DEFAULT_TIMEZONE)


@lru_cache(maxsize=8)
def _load_timezone(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        if name != DEFAULT_TIMEZONE:
            logger.warning("Unknown APP_TIMEZONE %r; using %s.", name, DEFAULT_TIMEZONE)
            return _load_timezone(DEFAULT_TIMEZONE)
        logger.warning("No tz database for %s; using a fixed UTC+06:00 offset.", name)
        return _DHAKA_FIXED


def app_timezone() -> ZoneInfo:
    """Timezone used for daily limits and stats (APP_TIMEZONE, default Asia/Dhaka)."""
    return _load_timezone(os.getenv("APP_TIMEZONE", "").strip() or DEFAULT_TIMEZONE)


def app_timezone_name() -> str:
    """IANA name of app_timezone(), e.g. "Asia/Dhaka" (for JSON and SQL)."""
    tz = app_timezone()
    return getattr(tz, "key", None) or DEFAULT_TIMEZONE


def local_now(now: datetime | None = None) -> datetime:
    """Current (or the given) instant in the app timezone; naive input is UTC."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(app_timezone())


def local_today(now: datetime | None = None) -> date:
    """Calendar date in the app timezone; the daily download counter keys on it."""
    return local_now(now).date()


def local_midnight(day: date) -> datetime:
    """Start of `day` in the app timezone (tz-aware), e.g. for date filters."""
    return datetime.combine(day, dt_time.min, tzinfo=app_timezone())


def next_reset_at(now: datetime | None = None) -> datetime:
    """Next local midnight (tz-aware), when daily download counts reset."""
    return local_midnight(local_today(now) + timedelta(days=1))
