"""Shared yt-dlp authentication options.

YouTube commonly challenges data-centre IP addresses and requires a logged-in
session. Cookie credentials are deliberately supplied only for YouTube URLs;
other extractors continue to run without access to them.
"""

import base64
import binascii
import contextlib
import hashlib
import os
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import logging

logger = logging.getLogger(__name__)


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


def is_youtube_url(url: str) -> bool:
    return _is_youtube_url(url)


_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def video_cache_key(url: str) -> str:
    """Identify the video a URL points at, for caching its extraction.

    Share links of one YouTube video differ (youtu.be/ID?si=..., watch?v=ID,
    shorts/ID), so they map to the video ID; any other URL is its own key.
    """
    url = url.strip()
    if not _is_youtube_url(url):
        return url
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    parts = [part for part in parsed.path.split("/") if part]
    if host == "youtu.be" or host.endswith(".youtu.be"):
        candidate = parts[0] if parts else None
    else:
        candidate = (parse_qs(parsed.query).get("v") or [None])[0]
        if not candidate and len(parts) >= 2 and parts[0] in ("shorts", "live", "embed", "v"):
            candidate = parts[1]
    if candidate and _YOUTUBE_ID_RE.match(candidate):
        return f"youtube:{candidate}"
    return url


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
# runtime, so it has to run in a separate, cookie-less attempt. "default"
# follows yt-dlp's own anonymous choice (visionos, plus web with a JS runtime).
_ANONYMOUS_PLAYER_CLIENTS = ["default", "web_embedded"]

# tv needs no PO token once signed in and returns the complete DASH ladder (up
# to 4K); web_embedded does the same for embeddable videos. Both use YouTube's
# player API, which answers data-centre IPs such as Render's with HTTP 403.
# web is kept because its player response comes from the watch page instead,
# so it still yields the 360p stream when the API is refused.
_AUTHENTICATED_PLAYER_CLIENTS = ["tv", "web_embedded", "web"]

# The watch page fetched with Safari's User-Agent embeds a player response
# whose HLS manifest lists every resolution up to 1080p. Read from the page,
# it needs no player API request, so it is the one route to HD that survives
# a player API that refuses this server's IP. It replaces web as the client
# read from the page, hence its own attempt.
_SAFARI_PAGE_EXTRACTOR_ARGS = {
    "player_client": ["web_safari"],
    "webpage_client": ["web_safari"],
}


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

    # The User-Agent belongs to the browser that exported the cookies, so it is
    # sent only with them; overriding it would break the app clients above.
    user_agent = os.getenv("YOUTUBE_USER_AGENT", "").strip()
    if user_agent:
        options["http_headers"] = {"User-Agent": user_agent}

    return options


def youtube_proxy() -> str | None:
    """Proxy URL for YouTube traffic, from YOUTUBE_PROXY, or None.

    YouTube refuses the player API to many data-centre IPs outright. Routing
    YouTube through a residential or ISP proxy is the dependable way past
    that; downloads must use it too, because stream URLs are bound to the IP
    that requested them. For the same reason the proxy needs a sticky session:
    yt-dlp opens a new connection per request, and a proxy that rotates its
    exit IP per connection makes every stream URL fail with HTTP 403.
    """
    return os.getenv("YOUTUBE_PROXY", "").strip() or None


# yt-dlp keeps YouTube's player script, preprocessed for the JS challenge
# solver, in its cache directory; without a writable one every extraction
# downloads and preprocesses the multi-megabyte script again. The default
# (~/.cache) is not guaranteed to be writable on a host.
_YT_DLP_CACHE_DIR = str(Path(tempfile.gettempdir()) / "unistream-yt-dlp-cache")


def _youtube_network_options() -> dict:
    # A link copied from a playlist (watch?v=ID&list=...) means that one video.
    options = {
        **js_runtime_options(),
        "noplaylist": True,
        "cachedir": _YT_DLP_CACHE_DIR,
    }
    proxy = youtube_proxy()
    if proxy:
        options["proxy"] = proxy
    return options


def youtube_ydl_attempts(url: str) -> list[tuple[str, dict]]:
    """Return (label, yt-dlp options) pairs to try in order for one URL.

    Other extractors get a single empty attempt and never see the YouTube
    cookies. YouTube is tried anonymously first, which yields every resolution
    whenever YouTube serves this IP, and then with the configured session for
    bot-challenged IPs and restricted videos: once through the Safari watch
    page and once through the player API.
    """
    if not _is_youtube_url(url):
        return [("default", {})]

    network_options = _youtube_network_options()
    attempts = [(
        "anonymous",
        {
            **network_options,
            "extractor_args": {"youtube": {"player_client": list(_ANONYMOUS_PLAYER_CLIENTS)}},
        },
    )]
    cookie_options = _youtube_cookie_options()
    if cookie_options:
        attempts.append((
            "cookies_safari",
            {
                **network_options,
                **cookie_options,
                "extractor_args": {"youtube": {
                    key: list(value) for key, value in _SAFARI_PAGE_EXTRACTOR_ARGS.items()
                }},
            },
        ))
        attempts.append((
            "cookies",
            {
                **network_options,
                **cookie_options,
                "extractor_args": {
                    "youtube": {"player_client": list(_AUTHENTICATED_PLAYER_CLIENTS)},
                },
            },
        ))
    return attempts


def _private_cookie_copy(cookiefile: str) -> str | None:
    """Copy the shared cookie file for one YoutubeDL instance.

    yt-dlp rewrites its cookie file in place when it closes, so instances
    sharing one file can read it half-written ("does not look like a Netscape
    format cookies file"). Each attempt works on its own copy instead.
    """
    try:
        data = Path(cookiefile).read_bytes()
    except OSError:
        return None
    fd, path = tempfile.mkstemp(prefix="unistream_cookies_", suffix=".txt")
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
    return path


def _write_back_cookies(private_path: str, cookiefile: str):
    """Keep cookies YouTube rotated during an attempt, replacing atomically."""
    try:
        data = Path(private_path).read_bytes()
        if not data.strip():
            return
        fd, staged = tempfile.mkstemp(
            prefix=".unistream_cookies_", suffix=".txt", dir=str(Path(cookiefile).parent)
        )
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(staged, cookiefile)
    except OSError:
        logger.debug("Could not write rotated YouTube cookies back", exc_info=True)
    finally:
        Path(private_path).unlink(missing_ok=True)


@contextlib.contextmanager
def private_cookiefile(options: dict):
    """Give one set of yt-dlp options its own copy of the cookie file."""
    shared = options.get("cookiefile")
    private = _private_cookie_copy(shared) if shared else None
    if not private:
        yield options
        return
    try:
        yield {**options, "cookiefile": private}
    finally:
        _write_back_cookies(private, shared)


def is_complete_listing(score: tuple[bool, int]) -> bool:
    """A listing no other attempt can beat on this server: a DASH ladder, or
    the Safari HLS ladder (720p/1080p) where the player API is refused."""
    return score[0] or score[1] >= 720


# The attempt that last produced a complete listing. Each attempt costs a
# watch-page download and a deno run, which on a tenth of a CPU dominate the
# wait, so later requests try the remembered attempt alone first. A full DASH
# ladder cannot be beaten and is kept; the HLS ladder (1080p) is re-checked
# against the other attempts now and then, in case the server's IP is
# served better again.
_ROUTE_LOCK = threading.Lock()
_ROUTE: dict = {}
_CAPPED_ROUTE_SECONDS = 2 * 60 * 60


def remembered_attempt(labels: list[str]) -> str | None:
    with _ROUTE_LOCK:
        label = _ROUTE.get("label")
        if not label or label not in labels:
            return None
        if _ROUTE["full_ladder"] or time.monotonic() - _ROUTE["at"] < _CAPPED_ROUTE_SECONDS:
            return label
        return None


def remember_attempt(label: str | None, score: tuple[bool, int] | None):
    """Record the winner of a full run, or forget it when nothing was complete."""
    with _ROUTE_LOCK:
        _ROUTE.clear()
        if label and score and is_complete_listing(score):
            _ROUTE.update(label=label, full_ladder=score[0], at=time.monotonic())


def prefer_attempt(
    attempts: list[tuple[str, dict]], label: str | None
) -> list[tuple[str, dict]]:
    """Move the attempt that produced the listed formats to the front.

    Downloads then start with the extraction that is known to offer the
    chosen format instead of first waiting for attempts that cannot.
    """
    if not label:
        return attempts
    return sorted(attempts, key=lambda attempt: attempt[0] != label)


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


_IP_BLOCKED_MESSAGE = (
    "YouTube is refusing this server's IP address (data-centre IPs such as "
    "Render's are blocked), so it offers no HD streams here. Set YOUTUBE_PROXY "
    "on the backend to a residential proxy with a sticky session (one exit "
    "IP), or run the backend on your own computer, which YouTube serves "
    "normally."
)
_PROXY_BLOCKED_MESSAGE = (
    "YouTube is refusing the configured YOUTUBE_PROXY too, or the proxy "
    "changes its exit IP between requests, which breaks YouTube's IP-bound "
    "stream links. Use a residential proxy with a sticky session."
)
_CHALLENGE_FAILED_MESSAGE = (
    "YouTube's stream-link challenge could not be solved, so its HD streams "
    "were skipped. Update yt-dlp and yt-dlp-ejs in requirements.txt and "
    "redeploy."
)
_IP_BLOCK_MARKERS = (
    "http error 403",
    "requested format is not available",
    "only images are available",
    "no video formats found",
)
_CHALLENGE_MARKERS = ("n challenge solving failed", "signature solving failed")


def _ip_blocked_message() -> str:
    return _PROXY_BLOCKED_MESSAGE if youtube_proxy() else _IP_BLOCKED_MESSAGE


def youtube_quality_notice(
    url: str,
    score: tuple[bool, int],
    attempt_errors: dict[str, str],
    attempt_warnings: dict[str, list[str]] | None = None,
) -> str | None:
    """Explain a YouTube listing that tops out at a 360p combined stream.

    Returns None when separate video streams or any resolution above 360p
    were listed, i.e. YouTube served this server normally. attempt_warnings
    are the yt-dlp warnings per attempt; yt-dlp only warns when it drops HD
    streams for an unsolved challenge or a refused HLS manifest.
    """
    if not _is_youtube_url(url) or score[0] or score[1] > 360:
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
    cookie_errors = [
        message for label, message in attempt_errors.items()
        if label.startswith("cookies") and "cookies" in message.lower()
    ]
    if cookie_errors:
        return cookie_errors[0]

    warnings = " ".join(
        message for messages in (attempt_warnings or {}).values() for message in messages
    ).lower()
    if any(marker in warnings for marker in _CHALLENGE_MARKERS):
        return _CHALLENGE_FAILED_MESSAGE
    if "failed to download m3u8" in warnings:
        return (
            "YouTube listed HD streams but refused to send their playlist to "
            "this server. " + _ip_blocked_message()
        )
    return _ip_blocked_message()


def youtube_resolution_cap_notice(source: str | None, score: tuple[bool, int]) -> str | None:
    """Say that a listing from the Safari watch page stops at 1080p.

    The Safari HLS ladder ends at 1080p. 1440p and 4K exist only as separate
    VP9/AV1 streams, which YouTube serves through its player API (refused to
    data-centre IPs) or SABR streaming (not supported by yt-dlp).
    """
    if source != "cookies_safari" or score[0]:
        return None
    return (
        "This server can get up to 1080p from YouTube. If the video has 1440p "
        "or 4K, YouTube serves those only to IPs it trusts: set YOUTUBE_PROXY "
        "to a residential proxy with a sticky session, or run the backend on "
        "your own computer."
    )


def youtube_failure_message(
    url: str,
    attempt_errors: dict[str, str],
    attempt_warnings: dict[str, list[str]] | None = None,
) -> str:
    """Pick the most useful explanation when no attempt produced a video.

    attempt_errors maps attempt labels to youtube_error_message() texts. With
    cookies configured only the signed-in attempts count: the anonymous one
    is bot-challenged on data-centre IPs whatever the cookies. A specific
    reason (private, unavailable, rejected cookies) beats the generic block.
    """
    signed_in = {
        label: message for label, message in attempt_errors.items()
        if label.startswith("cookies")
    }
    messages = list((signed_in or attempt_errors).values())
    warnings = " ".join(
        message for messages_ in (attempt_warnings or {}).values() for message in messages_
    ).lower()
    if _is_youtube_url(url) and any(marker in warnings for marker in _CHALLENGE_MARKERS):
        if all(message == _ip_blocked_message() for message in messages):
            return _CHALLENGE_FAILED_MESSAGE
    if not messages:
        if _is_youtube_url(url):
            return _ip_blocked_message()
        return "No downloadable video streams were found."
    for message in messages:
        if message != _ip_blocked_message():
            return message
    return messages[0]


# Extractor arguments probed one at a time by youtube_client_report().
_DIAGNOSTIC_PROBES = {
    "anonymous": {
        client: {"player_client": [client]}
        for client in ("visionos", "web_embedded", "web_safari", "android_vr")
    },
    "cookies": {
        "web_safari_watch_page": _SAFARI_PAGE_EXTRACTOR_ARGS,
        **{
            client: {"player_client": [client]}
            for client in ("tv", "web_embedded", "web_safari", "web", "mweb", "tv_downgraded")
        },
    },
}
_DIAGNOSTIC_DEBUG_MARKERS = (
    "JS runtimes:", "account cookies", "playability status", "skipped", "SABR",
)


class YtDlpLog:
    """Collects the yt-dlp messages that explain a missing format ladder.

    A logger receives yt-dlp's warnings even with no_warnings set, so it also
    captures why streams were dropped in otherwise quiet runs.
    """

    def __init__(self):
        self.notes: list[str] = []

    def _add(self, message: str):
        message = " ".join(str(message).split())[:240]
        if message not in self.notes:
            self.notes.append(message)

    @property
    def warnings(self) -> list[str]:
        return list(self.notes)

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
    network_options = _youtube_network_options()
    report: dict = {}
    for mode, probes in _DIAGNOSTIC_PROBES.items():
        if mode == "cookies" and not cookie_options:
            report[mode] = "not configured"
            continue

        report[mode] = {}
        for client, extractor_args in probes.items():
            log = YtDlpLog()
            opts = {
                "quiet": True,
                "verbose": True,
                "logger": log,
                "ignore_no_formats_error": True,
                **network_options,
                **(cookie_options if mode == "cookies" else {}),
                "extractor_args": {
                    "youtube": {key: list(value) for key, value in extractor_args.items()},
                },
            }
            result: dict = {}
            try:
                with private_cookiefile(opts) as probe_opts, \
                        yt_dlp.YoutubeDL(probe_opts) as ydl:
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
    if not _is_youtube_url(url):
        return message
    if "sign in to confirm" not in message.lower():
        if any(marker in message.lower() for marker in _IP_BLOCK_MARKERS):
            return _ip_blocked_message()
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
