"""Turn Facebook/Instagram share links into the video link yt-dlp knows.

The share buttons produce links such as facebook.com/share/v/<code>/,
facebook.com/share/r/<code>/, fb.watch/<code>/ and instagram.com/share/...
yt-dlp has no extractor for them; it relied on its generic extractor
following the redirect, and that extractor is disabled because it would
fetch any URL (SSRF, see yt_dlp_config.ALLOWED_EXTRACTORS). So the redirect
is followed here instead, one hop at a time, and every hop must stay on
Facebook or Instagram.
"""

import logging
import threading
import time
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

import security

logger = logging.getLogger(__name__)

_MAX_HOPS = 6
_TIMEOUT_SECONDS = 8
_CACHE_SECONDS = 3600
_CACHE_MAX = 512

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_cache: dict[str, tuple[float, str]] = {}
_lock = threading.Lock()


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().rstrip(".")


def needs_resolution(url: str) -> bool:
    """True for share/short links yt-dlp cannot read directly."""
    platform = security.detect_platform(url)
    if platform not in ("facebook", "instagram"):
        return False
    host = _host(url)
    path = urlparse(url).path or "/"
    if host == "fb.watch" or host.endswith(".fb.watch"):
        return True
    return path.startswith("/share/")


def _login_target(url: str) -> str | None:
    """facebook.com/login/?next=<video link> → the video link, if on-site."""
    parsed = urlparse(url)
    if not parsed.path.startswith(("/login", "/checkpoint")):
        return None
    target = (parse_qs(parsed.query).get("next") or [None])[0]
    if target and security.detect_platform(target) in ("facebook", "instagram"):
        return target
    return None


def resolve_share_url(url: str) -> str:
    """Return the video link a share link points to, or `url` unchanged.

    Never raises: when the redirect cannot be followed, yt-dlp gets the
    original link and the user sees its "not a video" message.
    """
    if not needs_resolution(url):
        return url

    now = time.monotonic()
    with _lock:
        cached = _cache.get(url)
        if cached and now - cached[0] < _CACHE_SECONDS:
            return cached[1]

    current = url
    try:
        with httpx.Client(
            follow_redirects=False, timeout=_TIMEOUT_SECONDS, headers=_HEADERS
        ) as client:
            for _ in range(_MAX_HOPS):
                response = client.get(current)
                location = response.headers.get("location")
                if not (300 <= response.status_code < 400 and location):
                    break
                nxt = urljoin(current, location)
                if security.detect_platform(nxt) not in ("facebook", "instagram"):
                    # Never follow a redirect off Facebook/Instagram.
                    break
                current = _login_target(nxt) or nxt
                if not needs_resolution(current):
                    break
    except httpx.HTTPError as exc:
        logger.warning("Could not resolve share link %s: %s", url, exc)
        return url

    if current == url or needs_resolution(current):
        return url

    with _lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        _cache[url] = (now, current)
    return current


def clear_cache():
    with _lock:
        _cache.clear()
