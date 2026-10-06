"""Shared yt-dlp authentication options.

YouTube commonly challenges data-centre IP addresses and requires a logged-in
session. Cookie credentials are deliberately supplied only for YouTube URLs;
other extractors continue to run without access to them.
"""

import base64
import binascii
import hashlib
import os
import shutil
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


# yt-dlp silently drops every client that cannot carry cookies (visionos,
# android_vr, ...) as soon as a cookie file is supplied. visionos is the client
# that still returns every resolution (as HLS) without a PO token or a JS
# runtime, so it has to run in a separate, cookie-less attempt. web is left
# out: without a PO token it adds only the 360p stream, at the cost of an
# extra request and a JS challenge.
_ANONYMOUS_PLAYER_CLIENTS = ["visionos", "web_embedded"]

# Logged-in extraction otherwise settles on tv_downgraded and web, which on a
# data-centre IP expose only one 360p combined stream. tv needs no PO token
# once signed in and returns the complete DASH ladder (up to 4K); web_embedded
# does the same for embeddable videos; web_safari adds an HLS ladder (up to
# 1080p). "default" (tv_downgraded, web) is left out: both return only the
# 360p stream here and each costs a request and a JS challenge.
_AUTHENTICATED_PLAYER_CLIENTS = ["tv", "web_embedded", "web_safari"]


def _find_deno() -> str | None:
    """Locate the deno binary installed by the yt-dlp[deno] extra.

    yt-dlp only searches PATH, and a host that starts uvicorn without the
    virtualenv's bin directory on PATH leaves it without a JS runtime. YouTube
    then cannot decipher stream URLs and lists only a 360p combined stream.
    """
    try:
        from deno import find_deno_bin
        return find_deno_bin()
    except Exception:
        return shutil.which("deno")


def js_runtime_options() -> dict:
    """yt-dlp options that point it at deno explicitly, or {} without one."""
    path = _find_deno()
    return {"js_runtimes": {"deno": {"path": path}}} if path else {}


def _youtube_cookie_options() -> dict:
    """Options for a logged-in YouTube attempt, or {} when none is configured."""
    options: dict = {}
    cookiefile = _configured_cookiefile()
    browser = os.getenv("YOUTUBE_COOKIES_BROWSER", "").strip().lower()

    if cookiefile:
        options["cookiefile"] = cookiefile
    elif browser:
        profile = os.getenv("YOUTUBE_COOKIES_BROWSER_PROFILE", "").strip() or None
        options["cookiesfrombrowser"] = (browser, profile, None, None)
    else:
        return {}

    options["extractor_args"] = {
        "youtube": {"player_client": list(_AUTHENTICATED_PLAYER_CLIENTS)},
    }

    # The User-Agent belongs to the browser that exported the cookies, so it is
    # sent only with them; overriding it would break the app clients above.
    user_agent = os.getenv("YOUTUBE_USER_AGENT", "").strip()
    if user_agent:
        options["http_headers"] = {"User-Agent": user_agent}

    return options


def youtube_ydl_attempts(url: str) -> list[tuple[str, dict]]:
    """Return (label, yt-dlp options) pairs to try in order for one URL.

    Other extractors get a single empty attempt and never see the YouTube
    cookies. YouTube is tried anonymously first, which yields every resolution
    whenever YouTube serves this IP, and then with the configured session for
    bot-challenged IPs and restricted videos.
    """
    if not _is_youtube_url(url):
        return [("default", {})]

    js_options = js_runtime_options()
    attempts = [(
        "anonymous",
        {
            **js_options,
            "extractor_args": {"youtube": {"player_client": list(_ANONYMOUS_PLAYER_CLIENTS)}},
        },
    )]
    cookie_options = _youtube_cookie_options()
    if cookie_options:
        attempts.append(("cookies", {**js_options, **cookie_options}))
    return attempts


def format_ladder_score(info: dict) -> tuple[bool, int]:
    """Rank an extraction: separate video streams first, then the top height.

    A degraded YouTube response holds only a 360p combined stream, while a
    healthy one lists video-only DASH/HLS streams for every resolution.
    """
    has_video_only, top_height = False, 0
    for f in info.get("formats") or []:
        vcodec = f.get("vcodec")
        if not vcodec or vcodec == "none":
            continue
        top_height = max(top_height, f.get("height") or 0)
        if f.get("acodec") == "none":
            has_video_only = True
    return has_video_only, top_height


def youtube_quality_notice(
    url: str, score: tuple[bool, int], attempt_errors: dict[str, str]
) -> str | None:
    """Explain a YouTube listing that holds only combined (360p) streams.

    Returns None when separate video streams were listed, i.e. every
    resolution the video has is available.
    """
    if not _is_youtube_url(url) or score[0]:
        return None

    if not _find_deno():
        return (
            "Only low resolutions are available because the server has no "
            "JavaScript runtime (deno). Redeploy with the packages in "
            "requirements.txt installed."
        )
    if youtube_auth_mode() == "not_configured":
        return (
            "YouTube gives this server only a 360p stream unless it is signed "
            "in. Set YOUTUBE_COOKIES_BASE64 on the backend (Render > "
            "Environment) to a base64 YouTube cookies.txt export, then redeploy."
        )
    if "cookies" in attempt_errors:
        return "The signed-in YouTube attempt failed: " + attempt_errors["cookies"][:300]
    return (
        "YouTube returned only a 360p stream even with the configured cookies. "
        "Export fresh cookies and update YOUTUBE_COOKIES_BASE64, or run the "
        "YouTube check in the admin panel."
    )


# Clients probed one at a time by youtube_client_report().
_DIAGNOSTIC_CLIENTS = {
    "anonymous": ["visionos", "web_embedded", "web_safari", "android_vr"],
    "cookies": ["tv", "web_embedded", "web_safari", "web", "mweb", "tv_downgraded"],
}
_DIAGNOSTIC_DEBUG_MARKERS = (
    "JS runtimes:", "account cookies", "playability status", "skipped", "SABR",
)


class _DiagnosticLog:
    """Collects the yt-dlp messages that explain a missing format ladder."""

    def __init__(self):
        self.notes: list[str] = []

    def _add(self, message: str):
        message = " ".join(str(message).split())[:240]
        if message not in self.notes:
            self.notes.append(message)

    def debug(self, message):
        if any(marker in message for marker in _DIAGNOSTIC_DEBUG_MARKERS):
            self._add(message)

    def info(self, _message):
        pass

    def warning(self, message):
        self._add(message)

    def error(self, message):
        self._add(message)


def youtube_client_report(url: str) -> dict:
    """Probe each YouTube client separately from this server's IP address.

    Reports heights, protocols and yt-dlp's own explanations so a deployment
    that lists only 360p can be diagnosed without reading host logs. Cookie
    values never leave the server.
    """
    import yt_dlp

    cookie_options = _youtube_cookie_options()
    js_options = js_runtime_options()
    report: dict = {}
    for mode, clients in _DIAGNOSTIC_CLIENTS.items():
        if mode == "cookies" and not cookie_options:
            report[mode] = "not configured"
            continue

        report[mode] = {}
        for client in clients:
            log = _DiagnosticLog()
            opts = {
                "quiet": True,
                "verbose": True,
                "logger": log,
                "ignore_no_formats_error": True,
                **js_options,
                **(cookie_options if mode == "cookies" else {}),
                "extractor_args": {"youtube": {"player_client": [client]}},
            }
            result: dict = {}
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                video = [
                    f for f in info.get("formats") or []
                    if f.get("vcodec") not in (None, "none") and f.get("height")
                ]
                result["heights"] = sorted({f["height"] for f in video})
                result["protocols"] = sorted({str(f.get("protocol")) for f in video})
                result["video_only_streams"] = format_ladder_score(info)[0]
            except Exception as exc:
                result["error"] = " ".join(str(exc).split())[:300]
            result["notes"] = log.notes[:8]
            report[mode][client] = result
    return report


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
