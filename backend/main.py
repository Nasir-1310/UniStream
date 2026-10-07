# backend/main.py
#
# Application entry point: the FastAPI app, CORS, error handlers, the health
# check and video analysis (/video-info).
#   Accounts:   backend/routers/auth.py        (/auth/*)
#   Admin:      backend/routers/admin_auth.py  (/admin/auth/*: sign-in)
#               backend/routers/admin.py       (/admin/*)
#   Downloads:  backend/routers/download.py    (/download/*)
#   Guards:     backend/dependencies.py        (sessions, quotas)
#               backend/admin_account.py       (admin account, require_admin)

import asyncio
import logging
import os
import re
import time
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from starlette.datastructures import MutableHeaders

import extraction_cache
import link_resolver
import security
from dependencies import require_user, too_many_requests
from routers.admin import router as admin_router
from routers.admin_auth import router as admin_auth_router
from routers.auth import router as auth_router
from routers.download import router as download_router
from storage import SchemaOutdatedError, StorageUnavailableError
from yt_dlp_config import (
    format_ladder_score,
    is_healthy_listing,
    is_youtube_url,
    remember_attempt,
    remembered_attempt,
    video_cache_key,
    youtube_video_key,
    private_cookiefile,
    YtDlpLog,
    youtube_error_message,
    youtube_ydl_attempts,
    youtube_failure_message,
    youtube_quality_notice,
    youtube_resolution_cap_notice,
)

backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

app = FastAPI(title="UniStream Saver API", version="2.0.0")
logger = logging.getLogger(__name__)
# uvicorn configures only its own loggers; without this the app's INFO lines
# (analysis timings) never reach the host's logs.
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
logger.setLevel(logging.INFO)


class RedactTokens(logging.Filter):
    """Blank `ticket=` and `token=` query values in uvicorn's access log.

    EventSource cannot send headers, so the download stream is opened with a
    ticket in its URL (and the file with a one-time token). Both are
    short-lived and single-use, but a live credential still has no place in
    the host's logs.
    """

    _PATTERN = re.compile(r"((?:^|[?&])(?:token|ticket)=)[^&\s\"]+")

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                self._PATTERN.sub(r"\1[redacted]", arg) if isinstance(arg, str) else arg
                for arg in record.args
            )
        return True


logging.getLogger("uvicorn.access").addFilter(RedactTokens())

# Analysing a video costs the server a watch-page fetch and a JS challenge
# run; it does not count toward the daily limit, so it is capped separately.
VIDEO_INFO_PER_USER = (40, 3600)

INTERNAL_ERROR_MESSAGE = "Something went wrong on our side. Please try again in a moment."
# No request this API accepts is anywhere near this size.
MAX_REQUEST_BODY_BYTES = 1024 * 1024
BODY_TOO_LARGE_MESSAGE = "This request is too large."


# ── Error handlers ────────────────────────────────────────────────────────────
# Every error body is {"detail": "<human readable string>"}: the frontend shows
# `detail` as is.

@app.exception_handler(SchemaOutdatedError)
async def schema_outdated_handler(_request: Request, exc: SchemaOutdatedError):
    # Retrying cannot help until the admin runs the migration script.
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(StorageUnavailableError)
async def storage_unavailable_handler(_request: Request, exc: StorageUnavailableError):
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc)},
        headers={"Retry-After": "3"},
    )


_FIELD_LABELS = {
    "login": "Email or phone",
    "username": "Username",
    "new_username": "Username",
    "ticket": "Download ticket",
    "current_password": "Current password",
    "new_password": "New password",
    "daily_limit": "Daily limit",
    "default_daily_limit": "Default daily limit",
    "older_than_days": "Days",
    "page_size": "Page size",
    "format_id": "Format",
    "url": "Link",
    "to": "Email",
    "ids": "Selection",
}


def _field_label(loc) -> str:
    names = [str(part) for part in loc if part not in ("body", "query", "path", "header")]
    names = [name for name in names if not name.isdigit()]
    if not names:
        return "Request body"
    name = names[-1]
    return _FIELD_LABELS.get(name, name.replace("_", " ").capitalize())


def validation_message(errors) -> str:
    """One readable sentence (or a few) from pydantic's error list.

    Our own validators raise complete sentences ("Please enter your email
    address."), which are used as they are; pydantic's generic messages get
    the field's name in front.
    """
    messages: list[str] = []
    for error in errors:
        kind = error.get("type", "")
        message = str(error.get("msg", "")).strip()
        label = _field_label(error.get("loc", ()))
        if kind == "missing":
            text = f"{label} is required."
        elif kind == "extra_forbidden":
            text = f"Unexpected field: {label}."
        elif kind == "json_invalid":
            text = "The request body is not valid JSON."
        elif kind == "value_error":
            text = message.removeprefix("Value error, ")
        else:
            text = f"{label}: {message[:1].lower()}{message[1:]}"
            if not text.endswith((".", "?", "!")):
                text += "."
        if text not in messages:
            messages.append(text)
    return " ".join(messages) or "Please check the details and try again."


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": validation_message(exc.errors())})


# ── Security headers, body size cap and the last-resort error handler ─────────

_SECURITY_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "no-referrer"),
)


class _BodyTooLarge(HTTPException):
    """Raised while the body is read. An HTTPException, so FastAPI's body
    parsing passes it on (it turns other errors into a 400)."""

    def __init__(self):
        super().__init__(status_code=413, detail=BODY_TOO_LARGE_MESSAGE)


class SecurityMiddleware:
    """Hardening for every response, as plain ASGI so SSE streams pass through
    untouched:

    * nosniff / DENY / no-referrer headers, and `Cache-Control: no-store`
      unless the route set its own (user, admin and auth data must not sit
      in a shared or browser cache);
    * request bodies over 1 MiB are refused with 413 before anything parses
      them;
    * an unexpected exception becomes a generic 500 JSON answer: stack traces
      and internal error text go to the server log only.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False

        async def send_with_headers(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = MutableHeaders(scope=message)
                for name, value in _SECURITY_HEADERS:
                    headers.setdefault(name, value)
                headers.setdefault("Cache-Control", "no-store")
            await send(message)

        for name, value in scope.get("headers") or ():
            if name == b"content-length":
                try:
                    too_large = int(value) > MAX_REQUEST_BODY_BYTES
                except ValueError:
                    too_large = True
                if too_large:
                    await self._reject_too_large(scope, receive, send_with_headers)
                    return

        received = 0

        async def receive_capped():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_REQUEST_BODY_BYTES:
                    raise _BodyTooLarge()
            return message

        try:
            await self.app(scope, receive_capped, send_with_headers)
        except _BodyTooLarge:
            if started:
                raise
            await self._reject_too_large(scope, receive, send_with_headers)
        except Exception:
            logger.exception("Unhandled error in %s %s", scope.get("method"), scope.get("path"))
            if started:
                raise
            response = JSONResponse(status_code=500, content={"detail": INTERNAL_ERROR_MESSAGE})
            await response(scope, receive, send_with_headers)

    @staticmethod
    async def _reject_too_large(scope, receive, send):
        response = JSONResponse(status_code=413, content={"detail": BODY_TOO_LARGE_MESSAGE})
        await response(scope, receive, send)


app.add_middleware(SecurityMiddleware)


# ── CORS ──────────────────────────────────────────────────────────────────────
# FRONTEND_URL may list several origins separated by commas (e.g. the Vercel
# production and preview domains). The browser reaches the API directly for
# the SSE progress stream and the YouTube check, so those origins need CORS.
# Authentication is by Bearer token, never cookies, so credentials stay off.

def _allowed_origins() -> list[str]:
    origins = ["http://localhost:3000"]
    for raw in os.getenv("FRONTEND_URL", "").split(","):
        origin = raw.strip().rstrip("/")
        if not origin:
            continue
        if "://" not in origin:
            origin = f"https://{origin}"
        if origin not in origins:
            origins.append(origin)
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "x-admin-secret"],
    expose_headers=["Content-Disposition", "Retry-After", "Server-Timing"],
    max_age=600,
)

# ── Mount routers ─────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(download_router)
app.include_router(admin_auth_router)
app.include_router(admin_router)


# ── Schemas ───────────────────────────────────────────────────────────────────

RequestedUrl = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=8, max_length=security.URL_MAX),
]


class VideoInfoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: RequestedUrl


# ── Helpers ───────────────────────────────────────────────────────────────────

def _human_size(size_bytes) -> str:
    if not size_bytes:
        return "Unknown"
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _format_size(f: dict, duration) -> tuple:
    """Exact or yt-dlp-approximated size, else an estimate from the bitrate.

    yt-dlp leaves HLS formats (YouTube's Safari streams) without a size,
    because a manifest's bitrate is a peak, so the estimate is marked "~".
    """
    filesize = f.get("filesize") or f.get("filesize_approx")
    if filesize:
        return filesize, _human_size(filesize)
    if f.get("tbr") and duration:
        estimate = int(f["tbr"] * 1000 / 8 * duration)
        return estimate, f"~{_human_size(estimate)}"
    return None, _human_size(None)


def _parse_formats(formats: list, info: dict) -> list:
    RESOLUTION_LABELS = {
        "2160": ("4K / Original", "🎬"),
        "1440": ("1440p HD",      "🎬"),
        "1080": ("1080p Full HD", "📺"),
        "720":  ("720p HD",       "📺"),
        "480":  ("480p Medium",   "📱"),
        "360":  ("360p Low",      "📱"),
        "240":  ("240p Very Low", "🔋"),
        "144":  ("144p Minimum",  "🔋"),
    }

    CODEC_PRIORITY = {
        "avc1": 0, "h264": 0,
        "vp9":  1, "vp09": 1,
        "av01": 2, "av1":  2,
    }

    def codec_rank(vcodec: str) -> int:
        if not vcodec:
            return 99
        v = vcodec.lower()
        for key, rank in CODEC_PRIORITY.items():
            if key in v:
                return rank
        return 5

    def codec_label(vcodec: str) -> str:
        if not vcodec:
            return ""
        v = vcodec.lower()
        if "avc1" in v or "h264" in v: return "H.264"
        if "vp9"  in v or "vp09" in v: return "VP9"
        if "av01" in v or "av1"  in v: return "AV1"
        return ""

    # Group by height, keep best codec per height
    height_map: dict = {}
    for f in formats:
        height = f.get("height")
        if not height:
            continue
        vcodec = f.get("vcodec", "")
        if not vcodec or vcodec == "none":
            continue
        h    = str(height)
        rank = codec_rank(vcodec)
        if h not in height_map or rank < height_map[h][1]:
            height_map[h] = (f, rank)

    video_options = []
    for h, (f, _) in height_map.items():
        label, icon = RESOLUTION_LABELS.get(h, (f"{h}p", "📹"))
        tag         = codec_label(f.get("vcodec", ""))
        filesize, filesize_human = _format_size(f, info.get("duration"))
        video_options.append({
            "type":           "video",
            "format_id":      f["format_id"],
            "label":          f"{label}{f' · {tag}' if tag else ''}",
            "icon":           icon,
            "resolution":     f"{h}p",
            "ext":            "mp4",
            "filesize_bytes": filesize,
            "filesize_human": filesize_human,
        })

    video_options.sort(
        key=lambda x: int(x["resolution"].replace("p", "")), reverse=True
    )

    # Best non-DRC audio-only stream → MP3. Some YouTube clients expose only a
    # combined stream; MP3 must still be offered because yt-dlp's
    # "bestaudio/best" selector can extract audio from that fallback.
    best_audio, best_audio_score = None, (-1, -1)
    for f in formats:
        vcodec = f.get("vcodec", "")
        acodec = f.get("acodec", "none")
        if (not vcodec or vcodec == "none") and acodec != "none":
            abr = f.get("abr") or 0
            is_non_drc = 0 if "drc" in str(f.get("format_id", "")).lower() else 1
            score = (is_non_drc, abr)
            if score > best_audio_score:
                best_audio_score = score
                best_audio = f

    best_abr = best_audio_score[1] if best_audio else 128
    abr_val  = int(best_abr) if best_abr else 128
    filesize = None
    if best_audio:
        filesize = best_audio.get("filesize") or best_audio.get("filesize_approx")
    video_options.append({
        "type":           "audio",
        "format_id":      best_audio["format_id"] if best_audio else "bestaudio",
        "label":          f"MP3 Audio Only · {abr_val}kbps",
        "icon":           "🎵",
        "resolution":     f"{abr_val}kbps",
        "ext":            "mp3",
        "filesize_bytes": filesize,
        "filesize_human": _human_size(filesize),
    })

    return video_options


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/")
def health():
    # Render sets RENDER_GIT_COMMIT, which shows whether a push is live yet.
    return {
        "status": "ok",
        "service": "UniStream Saver API v2",
        "commit": os.getenv("RENDER_GIT_COMMIT", "")[:7] or "local",
    }


@app.post("/video-info")
async def video_info(body: VideoInfoRequest, response: Response, user: dict = Depends(require_user)):
    """List a video's formats. Analysis does not count toward the daily limit."""
    import yt_dlp

    try:
        security.ensure_supported_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    limit, window = VIDEO_INFO_PER_USER
    allowed, retry_after = security.rate_limiter.hit("video_info", user["id"], limit, window)
    if not allowed:
        raise too_many_requests("Too many requests, try again in {wait}.", retry_after)

    started = time.monotonic()
    # Share links (facebook.com/share/v/..., fb.watch/...) become the video
    # link yt-dlp knows; only Facebook/Instagram hosts are ever contacted.
    url = await asyncio.to_thread(link_resolver.resolve_share_url, body.url)
    cache_key = video_cache_key(url)
    cached = extraction_cache.payload(cache_key)
    if cached is not None:
        response.headers["Server-Timing"] = "cache;desc=hit"
        return cached

    youtube = is_youtube_url(url)

    def _extract(attempt_opts: dict, log: YtDlpLog) -> dict:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
            # Receives yt-dlp's warnings despite no_warnings: the only trace
            # of HD streams dropped for an unsolved challenge or refused HLS.
            "logger": log,
        }
        ydl_opts.update(attempt_opts)
        with private_cookiefile(ydl_opts) as private_opts, \
                yt_dlp.YoutubeDL(private_opts) as ydl:
            return ydl.extract_info(url, download=False)

    try:
        attempts = youtube_ydl_attempts(url)
    except Exception as e:
        detail = youtube_error_message(url, e)
        raise HTTPException(status_code=400, detail=f"Could not fetch video info: {detail}")
    labels = [label for label, _opts in attempts]
    logs = {label: YtDlpLog() for label in labels}
    outcomes: dict = {}
    timings: dict[str, float] = {}

    async def _run(selected: list):
        # Attempts in one stage run side by side in worker threads, so a slow
        # one never queues behind another and the event loop stays free.
        async def _timed(label, opts):
            attempt_started = time.monotonic()
            try:
                return await asyncio.to_thread(_extract, opts, logs[label])
            finally:
                timings[label] = time.monotonic() - attempt_started

        results = await asyncio.gather(
            *(_timed(label, opts) for label, opts in selected), return_exceptions=True,
        )
        outcomes.update(zip((label for label, _opts in selected), results))

    # Each attempt costs a watch-page download and a deno run. Try the attempt
    # that last gave a healthy listing on its own first; only when it fails,
    # or gives the degraded 360p-only answer, do the others run.
    remembered = remembered_attempt(labels) if len(attempts) > 1 else None
    if remembered:
        await _run([attempt for attempt in attempts if attempt[0] == remembered])
        first = outcomes[remembered]
        if isinstance(first, Exception) or not is_healthy_listing(format_ladder_score(first)):
            await _run([attempt for attempt in attempts if attempt[0] not in outcomes])
    else:
        await _run(attempts)

    info, info_score, info_label = None, None, None
    attempt_errors: dict[str, str] = {}
    for label in labels:
        if label not in outcomes:
            continue
        candidate = outcomes[label]
        if isinstance(candidate, Exception):
            logger.warning("Video info %s attempt failed: %s", label, candidate)
            attempt_errors[label] = youtube_error_message(url, candidate)
            continue
        if youtube and (candidate.get("_type") == "playlist" or "entries" in candidate):
            raise HTTPException(
                status_code=400,
                detail="This link is a playlist or channel. Paste the link of a single video.",
            )
        score = format_ladder_score(candidate)
        if info is None or score > info_score:
            info, info_score, info_label = candidate, score, label

    if len(attempts) > 1 and len(outcomes) == len(attempts):
        # A full run that found a healthy listing decides which attempt later
        # requests try first.
        remember_attempt(info_label, info_score)

    total = time.monotonic() - started
    response.headers["Server-Timing"] = ", ".join(
        [f"total;dur={total * 1000:.0f}"]
        + [f"{label};dur={seconds * 1000:.0f}" for label, seconds in timings.items()]
    )
    logger.info(
        "Video info in %.1fs (%s)", total,
        ", ".join(f"{label} {seconds:.1f}s" for label, seconds in timings.items()),
    )

    if info is None or (youtube and info_score[1] == 0):
        detail = youtube_failure_message(
            url, attempt_errors, {label: log.warnings for label, log in logs.items()},
        )
        raise HTTPException(status_code=400, detail=f"Could not fetch video info: {detail}")

    if youtube and not info_score[0] and info_score[1] <= 360:
        logger.warning(
            "YouTube listed only combined streams up to %sp (%s attempt)",
            info_score[1], info_label,
        )

    formats = info.get("formats", [])
    result  = _parse_formats(formats, info)
    notice  = youtube_quality_notice(
        url, info_score, attempt_errors,
        {label: log.warnings for label, log in logs.items()},
    ) or youtube_resolution_cap_notice(info_label, info_score)

    payload = {
        "title":     info.get("title", ""),
        "thumbnail": info.get("thumbnail", ""),
        "duration":  info.get("duration", 0),
        "uploader":  info.get("uploader", ""),
        "platform":  info.get("extractor_key", ""),
        "formats":   result,
        "notice":    notice,
        # Downloads start with the attempt that listed these formats.
        "source":    info_label,
    }
    # A degraded 360p-only listing is not cached: it may be a passing
    # refusal, and the next request should try again. The info is kept in the
    # form yt-dlp's --load-info-json uses, so the download can reuse it. A
    # YouTube entry is stored under the ID yt-dlp extracted, never under one
    # read from the URL, so a cache hit always describes the right video.
    if not youtube:
        extraction_cache.store(cache_key, payload, info_label, None)
    elif is_healthy_listing(info_score) and youtube_video_key(info.get("id")):
        extraction_cache.store(
            youtube_video_key(info.get("id")), payload, info_label,
            yt_dlp.YoutubeDL.sanitize_info(info, remove_private_keys=True),
        )
    return payload
