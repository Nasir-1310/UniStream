# backend/main.py
import os
import yt_dlp
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv
from typing import Optional
from pathlib import Path

# Absolute path setup for Windows .env loader
backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

app = FastAPI(title="UniStream Saver API", version="1.0.0")

# ── CORS ─────────────────────────────────────────────────────────────────────
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "changeme")


# ── Schemas ───────────────────────────────────────────────────────────────────
class AccessCheckRequest(BaseModel):
    identifier: str          # email or phone number


class VideoInfoRequest(BaseModel):
    url: str
    identifier: str          # must be approved before fetching


class AdminAddUserRequest(BaseModel):
    identifier: str
    note: Optional[str] = None


class AdminUpdateStatusRequest(BaseModel):
    identifier: str
    status: str              # "approved" | "pending" | "blocked"


# ── Auth helper ───────────────────────────────────────────────────────────────
def require_admin(x_admin_secret: str = Header(...)):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Invalid admin secret")


# ── Helpers ───────────────────────────────────────────────────────────────────
def normalize(identifier: str) -> str:
    return identifier.strip().lower()


def get_user(identifier: str):
    resp = supabase.table("users").select("*").eq("identifier", normalize(identifier)).execute()
    if resp.data:
        return resp.data[0]
    return None


def _human_size(size_bytes) -> str:
    if not size_bytes:
        return "Unknown"
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _parse_formats(formats: list, info: dict) -> list:
    """
    Parses yt-dlp format list into clean resolution options for frontend grid.
    """
    PRIORITY = {
        "2160": ("4K / Original", "🎬"),
        "1440": ("1440p HD", "🎬"),
        "1080": ("1080p Full HD", "📺"),
        "720":  ("720p HD", "📺"),
        "480":  ("480p Medium", "📱"),
        "360":  ("360p Low", "📱"),
        "240":  ("240p Very Low", "🔋"),
        "144":  ("144p Minimum", "🔋"),
    }

    seen_heights = set()
    video_options = []

    for f in formats:
        height = f.get("height")
        if not height:
            continue
        
        vcodec = f.get("vcodec", "none")
        # Ensure we capture combined streams or video-only formats appropriately
        if vcodec == "none" or vcodec is None:
            continue

        h = str(height)
        if h in seen_heights:
            continue
        seen_heights.add(h)

        label, icon = PRIORITY.get(h, (f"{h}p", "📹"))
        ext = f.get("ext", "mp4")
        filesize = f.get("filesize") or f.get("filesize_approx")

        video_options.append({
            "type": "video",
            "format_id": f["format_id"],
            "label": label,
            "icon": icon,
            "resolution": f"{height}p",
            "ext": ext if ext in ("mp4", "webm") else "mp4",
            "filesize_bytes": filesize,
            "filesize_human": _human_size(filesize),
        })

    # Sort resolutions descending
    video_options.sort(key=lambda x: int(x["resolution"].replace("p", "")), reverse=True)

    # Extract best audio-only (MP3) Option
    best_audio = None
    best_abr = 0
    for f in formats:
        vcodec = f.get("vcodec", "")
        acodec = f.get("acodec", "none")
        if (vcodec == "none" or not vcodec) and acodec != "none":
            abr = f.get("abr") or 0
            if abr > best_abr:
                best_abr = abr
                best_audio = f

    if best_audio:
        abr_val = int(best_abr) if best_abr else 128
        video_options.append({
            "type": "audio",
            "format_id": best_audio["format_id"],
            "label": f"MP3 Audio ({abr_val}kbps)",
            "icon": "🎵",
            "resolution": f"{abr_val}kbps",
            "ext": "mp3",
            "filesize_bytes": best_audio.get("filesize") or best_audio.get("filesize_approx"),
            "filesize_human": _human_size(best_audio.get("filesize") or best_audio.get("filesize_approx")),
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
            "status": "pending",
        }).execute()
        return {"access": False, "message": "অ্যাক্সেস নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।"}

    if user["status"] == "approved":
        return {"access": True, "name": user.get("name", ""), "message": "স্বাগতম!"}

    return {"access": False, "message": "আপনার অ্যাকাউন্ট এখনো অ্যাপ্রুভ হয়নি। অ্যাডমিনের সাথে যোগাযোগ করুন।"}


@app.post("/video-info")
def video_info(body: VideoInfoRequest):
    user = get_user(body.identifier)
    if not user or user["status"] != "approved":
        raise HTTPException(status_code=403, detail="অ্যাক্সেস নেই")

    # Safe general options compatible with Facebook, YouTube, and others
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(body.url, download=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"ভিডিও তথ্য পাওয়া যায়নি: {str(e)}")

    formats = info.get("formats", [])
    result = _parse_formats(formats, info)

    # Async log to Supabase logs table
    supabase.table("download_logs").insert({
        "identifier": normalize(body.identifier),
        "url": body.url,
        "title": info.get("title", ""),
        "platform": info.get("extractor_key", ""),
    }).execute()

    return {
        "title": info.get("title", ""),
        "thumbnail": info.get("thumbnail", ""),
        "duration": info.get("duration", 0),
        "uploader": info.get("uploader", ""),
        "platform": info.get("extractor_key", ""),
        "formats": result,
    }


@app.get("/download")
def get_download_url(url: str, format_id: str, identifier: str, ext: str = "mp4"):
    user = get_user(identifier)
    if not user or user["status"] != "approved":
        raise HTTPException(status_code=403, detail="অ্যাক্সেস নেই")

    if ext == "mp3":
        target_format = "bestaudio/best"
    else:
        target_format = f"{format_id}/best"

    ydl_opts = {
        "quiet": True,
        "format": target_format,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            direct_url = None

            if "formats" in info:
                for f in info["formats"]:
                    if f.get("format_id") == format_id:
                        direct_url = f.get("url")
                        break

            if not direct_url:
                direct_url = info.get("url") or info.get("webpage_url")

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"download_url": direct_url, "ext": ext}


# ═══════════════════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS (protected by X-Admin-Secret header)
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
            "note": body.note,
        }).eq("identifier", normalize(body.identifier)).execute()
        return {"message": "ইউজার অ্যাপ্রুভ করা হয়েছে", "identifier": body.identifier}

    supabase.table("users").insert({
        "identifier": normalize(body.identifier),
        "status": "approved",
        "note": body.note,
    }).execute()
    return {"message": "নতুন ইউজার অ্যাড ও অ্যাপ্রুভ করা হয়েছে", "identifier": body.identifier}


@app.patch("/admin/users/status", dependencies=[Depends(require_admin)])
def admin_update_status(body: AdminUpdateStatusRequest):
    if body.status not in ("approved", "pending", "blocked"):
        raise HTTPException(status_code=400, detail="Invalid status")
    supabase.table("users").update({"status": body.status}).eq(
        "identifier", normalize(body.identifier)
    ).execute()
    return {"message": f"স্ট্যাটাস '{body.status}' করা হয়েছে"}


@app.delete("/admin/users/{identifier}", dependencies=[Depends(require_admin)])
def admin_delete_user(identifier: str):
    supabase.table("users").delete().eq("identifier", identifier).execute()
    return {"message": "ইউজার ডিলিট করা হয়েছে"}


@app.get("/admin/logs", dependencies=[Depends(require_admin)])
def admin_download_logs(limit: int = 50):
    resp = supabase.table("download_logs").select("*").order("created_at", desc=True).limit(limit).execute()
    return {"logs": resp.data}