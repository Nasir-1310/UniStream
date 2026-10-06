# backend/main.py
#
# Application entry point.
# Download logic lives in  backend/routers/download.py
# Auth dependency lives in backend/dependencies.py
# DB helpers live in       backend/database.py

import asyncio
import os
import time
import hmac
import logging
from pathlib import Path
from typing import Annotated, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, StringConstraints

import extraction_cache
from routers.download import router as download_router
from dependencies import get_user
from yt_dlp_config import (
    format_ladder_score,
    is_complete_listing,
    is_youtube_url,
    remember_attempt,
    remembered_attempt,
    video_cache_key,
    private_cookiefile,
    YtDlpLog,
    youtube_auth_mode,
    youtube_client_report,
    youtube_error_message,
    youtube_ydl_attempts,
    youtube_failure_message,
    youtube_proxy,
    youtube_quality_notice,
    youtube_resolution_cap_notice,
    js_runtime_options,
)
from storage import (
    delete_user,
    list_download_logs,
    list_users,
    set_user_status,
    StorageUnavailableError,
    storage_diagnostics,
    upsert_pending_user,
    upsert_user,
)

backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

app = FastAPI(title="UniStream Saver API", version="1.0.0")
logger = logging.getLogger(__name__)


@app.exception_handler(StorageUnavailableError)
async def storage_unavailable_handler(_request: Request, exc: StorageUnavailableError):
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc)},
        headers={"Retry-After": "3"},
    )

# ── CORS ──────────────────────────────────────────────────────────────────────
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Mount routers ─────────────────────────────────────────────────────────────
app.include_router(download_router)

# ── Admin secret ──────────────────────────────────────────────────────────────
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "").strip()


def require_admin(x_admin_secret: str = Header(...)):
    if not ADMIN_SECRET:
        raise HTTPException(status_code=503, detail="Admin access is not configured")
    if not hmac.compare_digest(x_admin_secret, ADMIN_SECRET):
        raise HTTPException(status_code=401, detail="Invalid admin secret")


# ── Schemas ───────────────────────────────────────────────────────────────────

Identifier = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=320),
]
RequestedUrl = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=8, max_length=4096),
]


class AccessCheckRequest(BaseModel):
    identifier: Identifier

class VideoInfoRequest(BaseModel):
    url: RequestedUrl
    identifier: Identifier

class AdminAddUserRequest(BaseModel):
    identifier: Identifier
    note: Annotated[Optional[str], StringConstraints(strip_whitespace=True, max_length=500)] = None

class AdminUpdateStatusRequest(BaseModel):
    identifier: Identifier
    status: Literal["approved", "pending", "blocked"]


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
        "service": "UniStream Saver API v1",
        "commit": os.getenv("RENDER_GIT_COMMIT", "")[:7] or "local",
    }


@app.post("/check-access")
def check_access(body: AccessCheckRequest):
    user = get_user(body.identifier)
    if not user:
        upsert_pending_user(body.identifier)
        return {"access": False, "message": "Access not granted. Please contact the admin."}

    if user["status"] == "approved":
        return {"access": True, "name": user.get("name", ""), "message": "Welcome!"}

    return {"access": False, "message": "Your account has not been approved yet. Please contact the admin."}


@app.post("/video-info")
async def video_info(body: VideoInfoRequest, response: Response):
    import yt_dlp

    started = time.monotonic()
    # get_user may query Supabase; keep that network call off the event loop.
    user = await asyncio.to_thread(get_user, body.identifier)
    if not user or user["status"] != "approved":
        raise HTTPException(status_code=403, detail="Access denied")

    cache_key = video_cache_key(body.url)
    cached = extraction_cache.payload(cache_key)
    if cached is not None:
        response.headers["Server-Timing"] = "cache;desc=hit"
        return cached

    youtube = is_youtube_url(body.url)

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
            return ydl.extract_info(body.url, download=False)

    try:
        attempts = youtube_ydl_attempts(body.url)
    except Exception as e:
        detail = youtube_error_message(body.url, e)
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
    # that last gave a complete listing on its own first; only when it fails,
    # or lists too little, do the others run.
    remembered = remembered_attempt(labels) if len(attempts) > 1 else None
    if remembered:
        await _run([attempt for attempt in attempts if attempt[0] == remembered])
        first = outcomes[remembered]
        if isinstance(first, Exception) or not is_complete_listing(format_ladder_score(first)):
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
            attempt_errors[label] = youtube_error_message(body.url, candidate)
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
        # A full run decides which attempt later requests try first.
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
            body.url, attempt_errors, {label: log.warnings for label, log in logs.items()},
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
        body.url, info_score, attempt_errors,
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
    # Only full-quality listings are cached; a 360p-only one may be a passing
    # refusal, and the next request should try again. The info is kept in
    # the form yt-dlp's --load-info-json uses, so the download can reuse it.
    if not youtube or is_complete_listing(info_score):
        extraction_cache.store(
            cache_key, payload, info_label,
            yt_dlp.YoutubeDL.sanitize_info(info, remove_private_keys=True) if youtube else None,
        )
    return payload


# ═══════════════════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/admin/users", dependencies=[Depends(require_admin)])
def admin_list_users(status: Optional[str] = None):
    users = list_users(status)
    return {"users": users, "total": len(users)}


@app.post("/admin/users", dependencies=[Depends(require_admin)])
def admin_add_user(body: AdminAddUserRequest):
    user = upsert_user(body.identifier, "approved", note=body.note)
    return {
        "message": "User saved and approved",
        "identifier": body.identifier,
        "user": user,
    }


@app.patch("/admin/users/status", dependencies=[Depends(require_admin)])
def admin_update_status(body: AdminUpdateStatusRequest):
    user = set_user_status(body.identifier, body.status)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"Status updated to '{body.status}'", "user": user}


@app.delete("/admin/users/{identifier}", dependencies=[Depends(require_admin)])
def admin_delete_user(identifier: str):
    delete_user(identifier)
    return {"message": "User deleted successfully"}


@app.get("/admin/logs", dependencies=[Depends(require_admin)])
def admin_download_logs(limit: int = 50):
    return {"logs": list_download_logs(limit)}


@app.get("/admin/storage", dependencies=[Depends(require_admin)])
def admin_storage_health():
    """
    Reports which store is live, where the SQLite file ended up, and the
    versions of the two tools a download depends on.  Without it a deployment
    that answers "/" fine but 500s on every database call can only be diagnosed
    from the host's own logs.
    """
    import yt_dlp
    from routers.download import FFMPEG_LOCATION

    info = storage_diagnostics()
    info["yt_dlp_version"] = yt_dlp.version.__version__
    info["ffmpeg_location"] = FFMPEG_LOCATION
    info["youtube_auth"] = youtube_auth_mode()
    info["youtube_proxy"] = "configured" if youtube_proxy() else "not configured"
    info["js_runtime"] = js_runtime_options().get("js_runtimes", {}).get("deno", {}).get("path")
    return info


@app.get("/admin/youtube-check", dependencies=[Depends(require_admin)])
def admin_youtube_check(url: str = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"):
    """
    Lists which YouTube clients return which resolutions from this server's IP.
    YouTube treats data-centre IPs differently, so a video that lists every
    resolution locally can list only 360p here; this shows which client to use.
    Takes a minute or two: each client is probed separately.
    """
    import yt_dlp

    return {
        "commit": os.getenv("RENDER_GIT_COMMIT", "")[:7] or "local",
        "yt_dlp_version": yt_dlp.version.__version__,
        "youtube_auth": youtube_auth_mode(),
        "youtube_proxy": "configured" if youtube_proxy() else "not configured",
        "js_runtime": js_runtime_options().get("js_runtimes", {}).get("deno", {}).get("path"),
        "clients": youtube_client_report(url),
    }
