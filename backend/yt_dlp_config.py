"""Shared yt-dlp authentication options.

YouTube commonly challenges data-centre IP addresses and requires a logged-in
session. Cookie credentials are deliberately supplied only for YouTube URLs;
other extractors continue to run without access to them.
"""

import base64
import binascii
import hashlib
import os
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlparse


_BACKEND_DIR = Path(__file__).resolve().parent
_COOKIE_LOCK = threading.Lock()
_COOKIE_CACHE: tuple[str, str] | None = None


def _is_youtube_url(url: str) -> bool:
    try:
        hostname = (urlparse(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return False

    return (
        hostname == "youtu.be"
        or hostname.endswith(".youtu.be")
        or hostname == "youtube.com"
        or hostname.endswith(".youtube.com")
        or hostname == "youtube-nocookie.com"
        or hostname.endswith(".youtube-nocookie.com")
    )


def _materialize_base64_cookies(encoded: str) -> str:
    """Decode a Netscape cookies file into a private process-temp file."""
    global _COOKIE_CACHE

    compact = "".join(encoded.split())
    digest = hashlib.sha256(compact.encode("ascii", errors="ignore")).hexdigest()

    with _COOKIE_LOCK:
        if _COOKIE_CACHE and _COOKIE_CACHE[0] == digest:
            cached_path = Path(_COOKIE_CACHE[1])
            if cached_path.is_file():
                return str(cached_path)

        try:
            cookie_bytes = base64.b64decode(compact, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise RuntimeError("YOUTUBE_COOKIES_BASE64 is not valid base64.") from exc

        if not cookie_bytes or len(cookie_bytes) > 1_000_000:
            raise RuntimeError("The decoded YouTube cookies file is empty or too large.")

        first_line = cookie_bytes.lstrip(b"\xef\xbb\xbf").splitlines()[0].strip()
        if first_line not in (b"# HTTP Cookie File", b"# Netscape HTTP Cookie File"):
            raise RuntimeError(
                "The YouTube cookies secret is not a Netscape-format cookies.txt file."
            )

        cookie_path = Path(tempfile.gettempdir()) / f"unistream_youtube_{digest[:16]}.txt"
        temporary_path = cookie_path.with_suffix(".tmp")
        temporary_path.write_bytes(cookie_bytes)
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, cookie_path)
        _COOKIE_CACHE = (digest, str(cookie_path))
        return str(cookie_path)


def _configured_cookiefile() -> str | None:
    encoded = os.getenv("YOUTUBE_COOKIES_BASE64", "").strip()
    if encoded:
        return _materialize_base64_cookies(encoded)

    configured_path = os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
    if not configured_path:
        local_cookie_path = _BACKEND_DIR / "youtube-cookies.txt"
        return str(local_cookie_path) if local_cookie_path.is_file() else None

    cookie_path = Path(configured_path).expanduser()
    if not cookie_path.is_absolute():
        cookie_path = _BACKEND_DIR / cookie_path
    cookie_path = cookie_path.resolve()
    if not cookie_path.is_file():
        raise RuntimeError(f"YOUTUBE_COOKIES_FILE does not exist: {cookie_path}")
    return str(cookie_path)


def youtube_ydl_options(url: str) -> dict:
    """Return authentication options only when the target is YouTube."""
    if not _is_youtube_url(url):
        return {}

    options: dict = {}
    cookiefile = _configured_cookiefile()
    browser = os.getenv("YOUTUBE_COOKIES_BROWSER", "").strip().lower()

    if cookiefile:
        options["cookiefile"] = cookiefile
    elif browser:
        profile = os.getenv("YOUTUBE_COOKIES_BROWSER_PROFILE", "").strip() or None
        options["cookiesfrombrowser"] = (browser, profile, None, None)

    user_agent = os.getenv("YOUTUBE_USER_AGENT", "").strip()
    if user_agent:
        options["http_headers"] = {"User-Agent": user_agent}

    return options


def youtube_auth_mode() -> str:
    """Report configuration presence without exposing credential material."""
    if os.getenv("YOUTUBE_COOKIES_BASE64", "").strip():
        return "base64_cookie_secret"
    if os.getenv("YOUTUBE_COOKIES_FILE", "").strip():
        return "cookie_file"
    if os.getenv("YOUTUBE_COOKIES_BROWSER", "").strip():
        return "browser"
    if (_BACKEND_DIR / "youtube-cookies.txt").is_file():
        return "local_cookie_file"
    return "not_configured"


def youtube_error_message(url: str, error: Exception) -> str:
    """Make YouTube authentication failures actionable without exposing secrets."""
    message = str(error)
    if not _is_youtube_url(url) or "sign in to confirm" not in message.lower():
        return message

    if youtube_auth_mode() != "not_configured":
        return (
            "YouTube rejected the configured session cookies. Export a fresh "
            "youtube.com cookies.txt file and update the server secret."
        )
    return (
        "YouTube is asking this server to confirm it is not a bot. "
        "Configure YOUTUBE_COOKIES_BASE64 on the backend with a fresh "
        "Netscape-format YouTube cookies.txt export."
    )
