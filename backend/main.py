# backend/main.py
#
# Application entry point.
# Download logic lives in  backend/routers/download.py
# Auth dependency lives in backend/dependencies.py
# DB helpers live in       backend/database.py

import os
import hmac
from pathlib import Path
from typing import Annotated, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints

from routers.download import router as download_router
from dependencies import get_user
from yt_dlp_config import youtube_auth_mode, youtube_error_message, youtube_ydl_options
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
        filesize    = f.get("filesize") or f.get("filesize_approx")
        video_options.append({
            "type":           "video",
            "format_id":      f["format_id"],
            "label":          f"{label}{f' · {tag}' if tag else ''}",
            "icon":           icon,
            "resolution":     f"{h}p",
            "ext":            "mp4",
            "filesize_bytes": filesize,
            "filesize_human": _human_size(filesize),
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
    return {"status": "ok", "service": "UniStream Saver API v1"}


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
async def video_info(body: VideoInfoRequest):
    import yt_dlp

    user = get_user(body.identifier)
    if not user or user["status"] != "approved":
        raise HTTPException(status_code=403, detail="Access denied")

    ydl_opts = {"quiet": True, "no_warnings": True, "extract_flat": False}
    try:
        ydl_opts.update(youtube_ydl_options(body.url))
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(body.url, download=False)
    except Exception as e:
        detail = youtube_error_message(body.url, e)
        raise HTTPException(status_code=400, detail=f"Could not fetch video info: {detail}")

    formats = info.get("formats", [])
    result  = _parse_formats(formats, info)

    return {
        "title":     info.get("title", ""),
        "thumbnail": info.get("thumbnail", ""),
        "duration":  info.get("duration", 0),
        "uploader":  info.get("uploader", ""),
        "platform":  info.get("extractor_key", ""),
        "formats":   result,
    }


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
    return info
