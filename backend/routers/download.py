# backend/routers/download.py
#
# Provides three endpoints, all mounted under the prefix "/download":
#
#   GET /download/progress   — SSE stream with real-time yt-dlp progress
#   GET /download/file       — serve the finished file via a one-time token
#   GET /download            — legacy direct-stream (kept for compatibility)
#
# Mount in main.py with:
#   app.include_router(download_router)   # no prefix — paths are explicit

import asyncio
import json
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote

import yt_dlp
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse

from ..dependencies import require_approved_user
from ..database import log_download

router = APIRouter(tags=["download"])

# ── In-memory job registry ─────────────────────────────────────────────────────
# Maps job_id  → progress dict
# Maps "token:<uuid>" → {filename, expires}
_jobs: dict[str, dict] = {}

# Semaphore shared with the legacy /download endpoint
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT_DOWNLOADS", "5"))
_semaphore = threading.Semaphore(MAX_CONCURRENT)


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_speed(bps: float) -> str:
    if bps <= 0:
        return "0 KB/s"
    if bps >= 1_048_576:
        return f"{bps / 1_048_576:.1f} MB/s"
    return f"{bps / 1024:.0f} KB/s"


def _fmt_eta(seconds) -> str:
    if seconds is None or seconds <= 0:
        return "--:--"
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _fmt_size(b) -> str:
    if b is None:
        return "?"
    if b >= 1_073_741_824:
        return f"{b / 1_073_741_824:.2f} GB"
    if b >= 1_048_576:
        return f"{b / 1_048_576:.1f} MB"
    return f"{b / 1024:.0f} KB"


def _human_size(size_bytes) -> str:
    if not size_bytes:
        return "Unknown"
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _clean_filename(title: str) -> str:
    """Remove view counts, stats, and filesystem-unsafe characters."""
    cleaned = re.sub(
        r'\b\d+(?:\.\d+)?[KkMmBb]?\s*(?:views?|likes?|reactions?|comments?|shares?|subscribers?)\b',
        '',
        title,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r'\b\d{5,}\b', '', cleaned)
    cleaned = re.sub(r'\s*[·|]\s*', ' ', cleaned)
    cleaned = re.sub(r'[\\/:*?"<>|]', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned[:180] if cleaned else "unistream_video"


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _build_ydl_opts_video(format_id: str, output_template: str) -> dict:
    """yt-dlp options for a video+audio merged MP4 download."""
    return {
        "quiet": True,
        "no_warnings": True,
        "format": f"{format_id}+bestaudio/best",
        "outtmpl": output_template,
        "merge_output_format": "mp4",
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
        "postprocessor_args": {
            "ffmpeg": ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]
        },
        "concurrent_fragment_downloads": 4,
        "retries": 3,
        "fragment_retries": 3,
    }


def _build_ydl_opts_audio(output_template: str) -> dict:
    """yt-dlp options for an audio-only MP3 download."""
    return {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "concurrent_fragment_downloads": 4,
        "retries": 3,
        "fragment_retries": 3,
    }


# ─────────────────────────────────────────────────────────────────────────────
# SSE progress endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/download/progress")
async def download_with_progress(
    url:        str = Query(...),
    format_id:  str = Query(...),
    ext:        str = Query(...),
    identifier: str = Query(...),
    _user           = Depends(require_approved_user),
):
    """
    SSE stream that drives the rich progress UI in the frontend.

    Flow:
      1. Opens an SSE connection.
      2. Starts yt-dlp in a thread pool, reporting progress via a hook.
      3. Polls the shared job dict every 250 ms and yields SSE events.
      4. On completion emits a one-time `token` the browser uses to fetch the file.
      5. Browser calls GET /download/file?token=<token> to trigger the save.
    """
    job_id  = str(uuid.uuid4())
    tmp_dir = tempfile.mkdtemp(prefix="unistream_")

    _jobs[job_id] = {
        "status":         "starting",
        "percent":        0,
        "speed":          "0 KB/s",
        "eta":            "--:--",
        "downloaded":     0,
        "total":          None,
        "downloaded_fmt": "0 KB",
        "total_fmt":      "?",
        "filename":       None,
        "error":          None,
        "done":           False,
    }

    # ── yt-dlp progress hook (runs in worker thread) ──────────────────────────
    def _hook(d: dict):
        job = _jobs[job_id]

        if d["status"] == "downloading":
            downloaded = d.get("downloaded_bytes") or 0
            total      = d.get("total_bytes") or d.get("total_bytes_estimate")
            speed_raw  = d.get("speed") or 0.0
            eta_secs   = d.get("eta")
            percent    = min(int(downloaded / total * 100), 99) if total else 0

            job.update({
                "status":         "downloading",
                "percent":        percent,
                "speed":          _fmt_speed(speed_raw),
                "eta":            _fmt_eta(eta_secs),
                "downloaded":     downloaded,
                "total":          total,
                "downloaded_fmt": _fmt_size(downloaded),
                "total_fmt":      _fmt_size(total),
            })

        elif d["status"] == "finished":
            job.update({
                "status":   "merging",
                "percent":  99,
                "eta":      "--:--",
                "filename": d.get("filename"),
            })

        elif d["status"] == "error":
            job.update({
                "status": "error",
                "error":  str(d.get("error", "Unknown error")),
                "done":   True,
            })

    # ── Background download coroutine ─────────────────────────────────────────
    async def _run_download():
        loop = asyncio.get_event_loop()
        output_template = str(Path(tmp_dir) / "%(title)s.%(ext)s")

        if ext == "mp3":
            ydl_opts = _build_ydl_opts_audio(output_template)
        else:
            ydl_opts = _build_ydl_opts_video(format_id, output_template)

        ydl_opts["progress_hooks"] = [_hook]

        def _blocking():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

        try:
            await loop.run_in_executor(None, _blocking)

            files = list(Path(tmp_dir).iterdir())
            if not files:
                raise FileNotFoundError("yt-dlp produced no output file")

            out_file = max(files, key=lambda f: f.stat().st_size)
            _jobs[job_id].update({
                "status":   "complete",
                "percent":  100,
                "filename": str(out_file),
                "done":     True,
            })

            try:
                await log_download(identifier=identifier, url=url)
            except Exception:
                pass

        except Exception as exc:
            _jobs[job_id].update({
                "status": "error",
                "error":  str(exc),
                "done":   True,
            })

    asyncio.create_task(_run_download())

    # ── SSE generator ─────────────────────────────────────────────────────────
    async def _event_stream():
        yield _sse({"status": "starting", "percent": 0, "job_id": job_id,
                    "speed": "0 KB/s", "eta": "--:--",
                    "downloaded_fmt": "0 KB", "total_fmt": "?",
                    "downloaded": 0, "total": None})

        POLL  = 0.25    # seconds
        LIMIT = 3600    # 1-hour safety cap
        elapsed = 0.0

        while elapsed < LIMIT:
            await asyncio.sleep(POLL)
            elapsed += POLL

            job    = _jobs.get(job_id, {})
            status = job.get("status", "starting")

            payload = {
                "status":         status,
                "percent":        job.get("percent", 0),
                "speed":          job.get("speed", "0 KB/s"),
                "eta":            job.get("eta", "--:--"),
                "downloaded_fmt": job.get("downloaded_fmt", "0 KB"),
                "total_fmt":      job.get("total_fmt", "?"),
                "downloaded":     job.get("downloaded", 0),
                "total":          job.get("total"),
            }

            if status == "complete":
                token = str(uuid.uuid4())
                _jobs[f"token:{token}"] = {
                    "filename": job["filename"],
                    "expires":  time.time() + 300,  # 5-minute window
                }
                payload["token"] = token
                yield _sse(payload)
                break

            elif status == "error":
                payload["error"] = job.get("error", "Unknown error")
                yield _sse(payload)
                break

            else:
                yield _sse(payload)

        _jobs.pop(job_id, None)

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# Token-based file-serve endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/download/file")
async def serve_download_file(token: str = Query(...)):
    """
    Called by the browser immediately after the SSE stream emits 'complete'.
    Serves the temp file once, then schedules deletion.
    """
    entry = _jobs.get(f"token:{token}")

    if not entry:
        raise HTTPException(status_code=404, detail="Token not found or already used.")

    if time.time() > entry["expires"]:
        _jobs.pop(f"token:{token}", None)
        raise HTTPException(status_code=410, detail="Download token has expired.")

    filepath = Path(entry["filename"])
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found on server.")

    # One-time use: remove token immediately
    _jobs.pop(f"token:{token}", None)

    clean_name = _clean_filename(filepath.stem) + filepath.suffix

    async def _cleanup():
        await asyncio.sleep(30)
        try:
            filepath.unlink(missing_ok=True)
            filepath.parent.rmdir()
        except Exception:
            pass

    asyncio.create_task(_cleanup())

    return FileResponse(
        path=str(filepath),
        filename=clean_name,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(clean_name)}",
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# Legacy direct-stream endpoint  (kept for backward compat)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/download")
def get_download(
    url:        str = Query(...),
    format_id:  str = Query(...),
    identifier: str = Query(...),
    ext:        str = Query("mp4"),
    _user           = Depends(require_approved_user),
):
    """
    Synchronous streaming download — no progress events.
    Kept so any client that still calls /download directly doesn't break.
    """
    acquired = _semaphore.acquire(blocking=True, timeout=30)
    if not acquired:
        raise HTTPException(status_code=503, detail="Server busy. Try again shortly.")

    tmp_dir         = tempfile.mkdtemp()
    output_template = os.path.join(tmp_dir, "%(title)s.%(ext)s")

    if ext == "mp3":
        ydl_opts = _build_ydl_opts_audio(output_template)
    else:
        ydl_opts = _build_ydl_opts_video(format_id, output_template)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info      = ydl.extract_info(url, download=True)
            raw_title = info.get("title", "unistream_video")

        output_file = next(
            (os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir)), None
        )
        if not output_file or not os.path.exists(output_file):
            raise HTTPException(status_code=500, detail="File could not be created.")

        file_size  = os.path.getsize(output_file)
        actual_ext = "mp3" if ext == "mp3" else "mp4"
        filename   = f"{_clean_filename(raw_title)}.{actual_ext}"

        def _iter_and_cleanup():
            try:
                with open(output_file, "rb") as f:
                    while chunk := f.read(1024 * 1024):
                        yield chunk
            finally:
                _semaphore.release()
                try:
                    os.remove(output_file)
                    os.rmdir(tmp_dir)
                except Exception:
                    pass

        return StreamingResponse(
            _iter_and_cleanup(),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
                "Content-Length":      str(file_size),
                "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
            },
        )

    except HTTPException:
        _semaphore.release()
        raise
    except Exception as exc:
        _semaphore.release()
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc))