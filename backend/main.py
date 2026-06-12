# backend/main.py
#
# Application entry point.
# Download logic lives in  backend/routers/download.py
# Auth dependency lives in backend/dependencies.py
# DB helpers live in       backend/database.py

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client

from .routers.download import router as download_router
from .dependencies import get_user, normalize, supabase

backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

app = FastAPI(title="UniStream Saver API", version="1.0.0")

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
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "changeme")


def require_admin(x_admin_secret: str = Header(...)):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Invalid admin secret")


# ── Schemas ───────────────────────────────────────────────────────────────────

class AccessCheckRequest(BaseModel):
    identifier: str

class VideoInfoRequest(BaseModel):
    url: str
    identifier: str

class AdminAddUserRequest(BaseModel):
    identifier: str
    note: Optional[str] = None

class AdminUpdateStatusRequest(BaseModel):
    identifier: str
    status: str


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

    # Best audio-only → MP3
    best_audio, best_abr = None, 0
    for f in formats:
        vcodec = f.get("vcodec", "")
        acodec = f.get("acodec", "none")
        if (not vcodec or vcodec == "none") and acodec != "none":
            abr = f.get("abr") or 0
            if abr > best_abr:
                best_abr  = abr
                best_audio = f

    if best_audio:
        abr_val  = int(best_abr) if best_abr else 128
        filesize = best_audio.get("filesize") or best_audio.get("filesize_approx")
        video_options.append({
            "type":           "audio",
            "format_id":      best_audio["format_id"],
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
        supabase.table("users").upsert({
            "identifier": normalize(body.identifier),
            "status":     "pending",
        }).execute()
        return {"access": False, "message": "Access not granted. Please contact the admin."}

    if user["status"] == "approved":
        return {"access": True, "name": user.get("name", ""), "message": "Welcome!"}

    return {"access": False, "message": "Your account has not been approved yet. Please contact the admin."}


@app.post("/video-info")
def video_info(body: VideoInfoRequest):
    import yt_dlp

    user = get_user(body.identifier)
    if not user or user["status"] != "approved":
        raise HTTPException(status_code=403, detail="Access denied")

    ydl_opts = {"quiet": True, "no_warnings": True, "extract_flat": False}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(body.url, download=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch video info: {e}")

    formats = info.get("formats", [])
    result  = _parse_formats(formats, info)

    try:
        supabase.table("download_logs").insert({
            "identifier": normalize(body.identifier),
            "url":        body.url,
            "title":      info.get("title", ""),
            "platform":   info.get("extractor_key", ""),
        }).execute()
    except Exception:
        pass

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
    query = supabase.table("users").select("*").order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    resp = query.execute()
    return {"users": resp.data, "total": len(resp.data)}


@app.post("/admin/users", dependencies=[Depends(require_admin)])
def admin_add_user(body: AdminAddUserRequest):
    existing = get_user(body.identifier)
    if existing:
        supabase.table("users").update({
            "status": "approved",
            "note":   body.note,
        }).eq("identifier", normalize(body.identifier)).execute()
        return {"message": "User approved successfully", "identifier": body.identifier}

    supabase.table("users").insert({
        "identifier": normalize(body.identifier),
        "status":     "approved",
        "note":       body.note,
    }).execute()
    return {"message": "New user added and approved", "identifier": body.identifier}


@app.patch("/admin/users/status", dependencies=[Depends(require_admin)])
def admin_update_status(body: AdminUpdateStatusRequest):
    if body.status not in ("approved", "pending", "blocked"):
        raise HTTPException(status_code=400, detail="Invalid status value")
    supabase.table("users").update({"status": body.status}).eq(
        "identifier", normalize(body.identifier)
    ).execute()
    return {"message": f"Status updated to '{body.status}'"}


@app.delete("/admin/users/{identifier}", dependencies=[Depends(require_admin)])
def admin_delete_user(identifier: str):
    supabase.table("users").delete().eq("identifier", identifier).execute()
    return {"message": "User deleted successfully"}


@app.get("/admin/logs", dependencies=[Depends(require_admin)])
def admin_download_logs(limit: int = 50):
    resp = (
        supabase.table("download_logs")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"logs": resp.data}