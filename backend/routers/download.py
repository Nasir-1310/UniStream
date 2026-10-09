# backend/routers/download.py
#
# Provides three endpoints, mounted without a prefix (paths are explicit):
#
#   POST /download/ticket    — checks the link and today's limit, returns a
#                              single-use ticket valid for 60 seconds
#   GET  /download/progress  — SSE stream with real-time yt-dlp progress
#   GET  /download/file      — serve the finished file via a one-time token
#
# EventSource cannot send an Authorization header, and a session token in a
# URL ends up in proxy and access logs, so the stream is opened with a ticket
# instead: signed, bound to the account and to this one download, usable
# once. A download needs a supported platform and room in the account's
# daily limit. It counts toward the limit, and is written to the audit log,
# only once it completes.
#
# Mount in main.py with:
#   app.include_router(download_router)   # no prefix — paths are explicit

import asyncio
import hmac
import json
import logging
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import quote

import yt_dlp
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

import dependencies
import security
import storage
import extraction_cache
import link_resolver
from yt_dlp_config import (
    is_youtube_url,
    prefer_attempt,
    private_cookiefile,
    youtube_error_message,
    video_cache_key,
    youtube_ydl_attempts,
)

router = APIRouter(tags=["download"])
logger = logging.getLogger(__name__)

# ── In-memory job registry ─────────────────────────────────────────────────────
# Maps job_id  → progress dict
# Maps "token:<random>" → {filename, expires, job_id, user_id}
_jobs: dict[str, dict] = {}

# Server-wide cap on simultaneous downloads (each account may run two).
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT_DOWNLOADS", "5"))
_semaphore = threading.Semaphore(MAX_CONCURRENT)

# Tickets per account and hour; each one is a pre-check against the database.
TICKETS_PER_USER = (30, 3600)
FILE_TOKEN_TTL_SECONDS = 300
FILE_TOKEN_MAX = 128

TICKET_EXPIRED_MESSAGE = "This download link has expired. Please start the download again."
FILE_GONE_MESSAGE = (
    "This download link has expired or was already used. Please download the video again."
)

TEMP_PREFIX = "unistream_"
# Older than any live download (1-hour stream cap + 5-minute file token).
STALE_TEMP_SECONDS = 2 * 3600


def sweep_stale_temp_dirs(root: str | None = None, max_age: float = STALE_TEMP_SECONDS) -> int:
    """Delete download folders a previous process left behind; returns how many.

    Unfetched files are normally removed after FILE_TOKEN_TTL_SECONDS by a
    task in memory, so a restart or crash in that window leaked them for good
    (each one a whole video) until the disk filled. Only folders older than
    any live download are touched, so other processes sharing /tmp are safe.
    """
    removed = 0
    cutoff = time.time() - max_age
    try:
        candidates = list(Path(root or tempfile.gettempdir()).glob(f"{TEMP_PREFIX}*"))
    except OSError:
        return 0
    for folder in candidates:
        try:
            if folder.is_dir() and not folder.is_symlink() and folder.stat().st_mtime < cutoff:
                shutil.rmtree(folder, ignore_errors=True)
                removed += 1
        except OSError:
            continue
    return removed


sweep_stale_temp_dirs()


# ── ffmpeg discovery ───────────────────────────────────────────────────────────
# yt-dlp shells out to ffmpeg to merge the separate video and audio streams into
# an MP4 and to transcode MP3.  Render's native Python runtime ships no ffmpeg
# binary, so every merged download failed there.  Fall back to the static build
# that comes with the imageio-ffmpeg wheel when the host has none of its own.

def _resolve_ffmpeg() -> str | None:
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG_LOCATION = _resolve_ffmpeg()


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


def _video_format_selector(
    format_id: str, height: int | None, allow_fallback: bool
) -> str:
    """Build the yt-dlp selector for one listed resolution.

    Format ids differ between YouTube clients (DASH itags vs. HLS ids), so the
    chosen height is matched as well. A chosen height is never downgraded:
    the fallback that once turned a refused 1080p stream into a silent 360p
    download is kept only for callers that send no height.
    """
    # AAC (m4a) audio first: it goes into MP4 as a plain stream copy, so the
    # merge is a quick file copy instead of re-encoding the soundtrack.
    def with_audio(video: str) -> list[str]:
        return [f"{video}+bestaudio[ext=m4a]", f"{video}+bestaudio"]

    selectors = with_audio(format_id)
    if height:
        selectors += [*with_audio(f"bv*[height={height}]"), f"b[height={height}]"]
    elif allow_fallback:
        selectors += [*with_audio("bv*"), "best"]
    return "/".join(selectors)


# yt-dlp skips an HLS segment that keeps failing and still reports success,
# which served lectures with gaps. Fail instead, after more retries.
_FRAGMENT_OPTIONS = {
    "fragment_retries": 10,
    "skip_unavailable_fragments": False,
}


def _build_ydl_opts_video(
    format_id: str,
    output_template: str,
    allow_fallback: bool = True,
    height: int | None = None,
) -> dict:
    """yt-dlp options for a video+audio merged MP4 download.

    Without allow_fallback a missing resolution fails instead of silently
    downgrading, so the next extraction attempt can still provide it.
    """
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": _video_format_selector(format_id, height, allow_fallback),
        "outtmpl": output_template,
        "windowsfilenames": True,
        "trim_file_name": 150,
        # Streams are copied, never re-encoded. Re-encoding the audio of a long
        # video took many minutes of the free instance's tenth of a CPU (and
        # its memory) in the "merging" step, where large downloads failed.
        "merge_output_format": "mp4",
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
        "concurrent_fragment_downloads": 4,
        "retries": 3,
        **_FRAGMENT_OPTIONS,
    }
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    return opts


def _build_ydl_opts_audio(output_template: str) -> dict:
    """yt-dlp options for an audio-only MP3 download."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        # Without an audio-only stream (YouTube's Safari HLS streams all carry
        # video), take a small combined stream rather than the 1080p one.
        "format": "bestaudio/best[height<=480]/best",
        "outtmpl": output_template,
        "windowsfilenames": True,
        "trim_file_name": 150,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "concurrent_fragment_downloads": 4,
        "retries": 3,
        **_FRAGMENT_OPTIONS,
    }
    if FFMPEG_LOCATION:
        opts["ffmpeg_location"] = FFMPEG_LOCATION
    return opts


def _clear_dir(tmp_dir: str):
    """Remove what a failed attempt left; the caller serves the largest file."""
    for leftover in Path(tmp_dir).iterdir():
        if leftover.is_dir():
            shutil.rmtree(leftover, ignore_errors=True)
        else:
            leftover.unlink(missing_ok=True)


def _download_with_fallback(
    url: str,
    format_id: str,
    ext: str,
    tmp_dir: str,
    progress_hooks=None,
    height: int | None = None,
    source: str | None = None,
) -> dict:
    """Download through each extraction attempt until one yields the format.

    The listed formats may come from any attempt in youtube_ydl_attempts(), so
    the requested format is matched exactly on every attempt but the last.
    Any failure moves on to the next attempt: with skip_unavailable_fragments
    off, a lost HLS segment can surface as an error other than DownloadError.

    When /video-info just analysed this video, its info is reused first, the
    way yt-dlp's --load-info-json does, so the download starts without a
    second watch-page fetch and deno run.
    """
    output_template = str(Path(tmp_dir) / "%(title).150B.%(ext)s")
    # Same share-link resolution as /video-info (cached, so usually instant).
    url = link_resolver.resolve_share_url(url)
    attempts = prefer_attempt(youtube_ydl_attempts(url), source)
    last_error = None

    def _options(attempt_opts: dict, allow_fallback: bool) -> dict:
        if ext == "mp3":
            ydl_opts = _build_ydl_opts_audio(output_template)
        else:
            ydl_opts = _build_ydl_opts_video(
                format_id, output_template, allow_fallback, height
            )
        ydl_opts.update(attempt_opts)
        if ydl_opts.get("proxy"):
            # Through a proxy (WARP) every parallel fragment is buffered in it
            # while the tenth of a CPU catches up: fewer at once keeps a long
            # 4K download inside the instance's 512 MB.
            ydl_opts["concurrent_fragment_downloads"] = 2
        if progress_hooks:
            ydl_opts["progress_hooks"] = progress_hooks
        return ydl_opts

    cache_key = video_cache_key(url)
    cached_info = (
        extraction_cache.info(cache_key, source)
        if source and is_youtube_url(url) else None
    )
    source_opts = dict(attempts).get(source)
    if cached_info is not None and source_opts is not None:
        _clear_dir(tmp_dir)
        try:
            with private_cookiefile(_options(source_opts, False)) as private_opts, \
                    yt_dlp.YoutubeDL(private_opts) as ydl:
                return ydl.process_ie_result(cached_info, download=True)
        except yt_dlp.utils.DownloadCancelled:
            raise
        except Exception as exc:
            logger.warning("Download from the analysed info failed, extracting again: %s", exc)
            extraction_cache.discard_info(cache_key)

    for index, (label, attempt_opts) in enumerate(attempts):
        _clear_dir(tmp_dir)
        try:
            is_last = index == len(attempts) - 1
            with private_cookiefile(_options(attempt_opts, is_last)) as private_opts, \
                    yt_dlp.YoutubeDL(private_opts) as ydl:
                return ydl.extract_info(url, download=True)
        except yt_dlp.utils.DownloadCancelled:
            # The browser left (see _hook): no other attempt is wanted either.
            raise
        except Exception as exc:
            logger.warning("Download %s attempt failed: %s", label, exc)
            last_error = exc

    message = str(last_error).lower()
    if height and "requested format is not available" in message:
        raise RuntimeError(
            f"YouTube did not provide the {height}p stream for this download. "
            "Try again, or choose another resolution."
        ) from last_error
    if not isinstance(last_error, yt_dlp.utils.DownloadError):
        raise RuntimeError(
            "The download stopped because part of the stream could not be "
            "fetched. Please try again."
        ) from last_error
    raise last_error


# ─────────────────────────────────────────────────────────────────────────────
# SSE progress endpoint
# ─────────────────────────────────────────────────────────────────────────────

_SSE_HEADERS = {
    "Cache-Control":     "no-cache, no-transform",
    "Connection":        "keep-alive",
    "X-Accel-Buffering": "no",   # disable nginx buffering
}

_UNAVAILABLE_MESSAGE = (
    "Downloads are temporarily unavailable. Please try again in a minute."
)


class _ServerBusy(RuntimeError):
    """Every server-wide download slot stayed taken for 30 seconds."""


def _sse_refusal(message: str, code: str | None) -> StreamingResponse:
    """A download refused before it started, as a single SSE error event.

    EventSource cannot read an HTTP error status or body, so the reason
    travels as an event; `code` ("auth" | "limit" | "platform" | "busy" |
    "gone", a download that can no longer be resumed)
    tells the page how to react.
    """
    event = {
        "status": "error", "error": message, "percent": 0,
        "speed": "0 KB/s", "eta": "--:--", "downloaded_fmt": "0 KB",
        "total_fmt": "?", "downloaded": 0, "total": None,
    }
    if code:
        event["code"] = code

    async def _stream():
        yield _sse(event)

    return StreamingResponse(_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


class TicketRequest(BaseModel):
    """What to download; everything the stream needs travels in the ticket."""

    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=security.URL_MAX)
    format_id: str = Field(min_length=1, max_length=security.FORMAT_ID_MAX)
    ext: Literal["mp4", "mp3"]
    height: Optional[int] = Field(None, ge=1, le=security.HEIGHT_MAX)
    source: Optional[str] = Field(None, max_length=security.SOURCE_MAX)

    @field_validator("url", "format_id", mode="before")
    @classmethod
    def _strip(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("format_id", "source")
    @classmethod
    def _printable(cls, value):
        if value is not None and not value.isprintable():
            raise ValueError("Choose a quality from the list.")
        return value


def _quality_label(ext: str, height: int | None) -> str:
    """Audit-log quality, e.g. "1080p MP4" or "MP3"."""
    if ext == "mp3":
        return "MP3"
    return f"{height}p MP4" if height else "MP4"


@router.post("/download/ticket")
def create_download_ticket(body: TicketRequest, user: dict = Depends(dependencies.require_user)):
    """Step 1 of a download: {"ticket", "expires_in": 60}.

    Runs the same checks as the stream start (platform, account, today's
    limit) so the page can show a refusal as a normal error. It reserves
    nothing: the stream start does, and only a completed download counts.
    """
    try:
        security.ensure_supported_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    dependencies.limit_rule(
        "download_tickets", user["id"], TICKETS_PER_USER,
        "Too many download attempts. Try again in {wait}.",
    )
    dependencies.check_download_room(user)
    ticket = security.create_download_ticket(
        user["id"],
        security.password_version(user.get("password_hash")),
        url=body.url,
        format_id=body.format_id,
        ext=body.ext,
        height=body.height,
        source=body.source,
    )
    return {"ticket": ticket, "expires_in": security.DOWNLOAD_TICKET_TTL_SECONDS}


# How long a download keeps running after its progress stream dropped, so the
# page can reconnect. Mobile networks and proxies cut long-lived connections,
# and a phone pauses a page that is in the background (the user switched apps
# while a long 4K download was merging). Sixty seconds threw such downloads
# away just before they finished; ten minutes covers a look at another app.
RESUME_GRACE_SECONDS = 10 * 60
JOB_GONE_MESSAGE = (
    "This download stopped while the page was away (or the server restarted). "
    "Please start it again."
)


async def _drop_if_unwatched(job_id: str):
    await asyncio.sleep(RESUME_GRACE_SECONDS)
    job = _jobs.get(job_id)
    if job is not None and job.get("watchers", 0) <= 0:
        # Nobody came back: the progress hook now cancels the download, and a
        # finished but unfetched file is discarded uncounted by _run_download
        # or expires with its file token.
        _jobs.pop(job_id, None)


def _follow_job(job_id: str, first_event: dict | None = None):
    """SSE events for one job, until it completes or fails."""

    async def _event_stream():
        job = _jobs.get(job_id)
        if job is None:
            return
        job["watchers"] = job.get("watchers", 0) + 1
        finished = False
        try:
            # A leading SSE comment makes even small-response-buffering proxies
            # flush their headers immediately. EventSource ignores comment lines.
            yield ":" + (" " * 2048) + "\n\n"
            if first_event is not None:
                yield _sse(first_event)

            POLL  = 0.25    # seconds
            LIMIT = 3600    # 1-hour safety cap
            elapsed = 0.0

            while elapsed < LIMIT:
                await asyncio.sleep(POLL)
                elapsed += POLL

                job = _jobs.get(job_id)
                if job is None:
                    break
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
                    payload["token"] = job["token"]
                    payload["usage"] = job.get("usage")
                    yield _sse(payload)
                    finished = True
                    break

                elif status == "error":
                    payload["error"] = job.get("error", "Unknown error")
                    if job.get("code"):
                        payload["code"] = job["code"]
                    yield _sse(payload)
                    finished = True
                    break

                else:
                    yield _sse(payload)
        finally:
            job = _jobs.get(job_id)
            if job is not None:
                job["watchers"] = job.get("watchers", 1) - 1
                if finished:
                    _jobs.pop(job_id, None)
                elif job["watchers"] <= 0:
                    # The browser disconnected mid-download: give it a short
                    # window to reconnect before the download is abandoned.
                    asyncio.create_task(_drop_if_unwatched(job_id))

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.get("/download/progress")
async def download_with_progress(
    ticket: str | None = Query(None),
    job: str | None = Query(None, max_length=64),
    resume: str | None = Query(None, max_length=128),
):
    """
    SSE stream that drives the rich progress UI in the frontend.

    Flow:
      1. Spends the ticket (forged, expired or reused -> code "auth"), then
         checks the account, the platform and the daily limit again, and
         reserves one of the account's download slots (refusals arrive as
         one SSE error event with a `code`). What to download comes only
         from the ticket.
      2. Starts yt-dlp in a thread pool, reporting progress via a hook.
      3. Polls the shared job dict every 250 ms and yields SSE events.
      4. On completion counts the download, writes the audit log and emits a
         one-time `token` (plus the account's updated `usage`).
      5. Browser calls GET /download/file?token=<token> to trigger the save.
    """
    if job is not None or resume is not None:
        # Reconnecting to a running download after the stream dropped.
        existing = _jobs.get(job or "")
        if (
            existing is None
            or not resume
            or not hmac.compare_digest(str(existing.get("resume", "")), resume)
        ):
            # Not "auth": nothing is wrong with the account, the job is gone.
            return _sse_refusal(JOB_GONE_MESSAGE, "gone")
        return _follow_job(job)

    claims = security.verify_download_ticket(ticket) if ticket else None
    if claims is None or not security.used_tickets.consume(claims["jti"], claims["exp"]):
        return _sse_refusal(TICKET_EXPIRED_MESSAGE, "auth")
    url, format_id, ext = claims["url"], claims["format_id"], claims["ext"]
    height, source = claims["height"], claims["source"]

    try:
        user, platform, limit = await asyncio.to_thread(dependencies.reserve_download, claims)
    except dependencies.DownloadRefused as refusal:
        return _sse_refusal(refusal.message, refusal.code)
    except storage.StorageUnavailableError as exc:
        logger.warning("Download refused, storage unavailable: %s", exc)
        return _sse_refusal(_UNAVAILABLE_MESSAGE, None)

    user_id = user["id"]
    job_id  = str(uuid.uuid4())
    try:
        tmp_dir = tempfile.mkdtemp(prefix=TEMP_PREFIX)
    except OSError:
        # e.g. a full disk: give the slot back, or the account stays "busy".
        dependencies.release_download(user_id)
        logger.exception("Could not create a download folder")
        return _sse_refusal(_UNAVAILABLE_MESSAGE, None)

    resume_code = secrets.token_urlsafe(24)
    _jobs[job_id] = {
        "resume":         resume_code,
        "watchers":       0,
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
        job = _jobs.get(job_id)
        if not job:
            # The browser closed the stream: nobody can fetch this file, so
            # stop now instead of holding a server-wide download slot (and
            # the account's) until a possibly hour-long download ends.
            raise yt_dlp.utils.DownloadCancelled("The browser left before the download finished.")

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
        loop = asyncio.get_running_loop()
        acquired = False
        # The account's slot is held until the download is counted or fails.
        reserved = True

        try:
            acquired = await asyncio.to_thread(
                _semaphore.acquire,
                blocking=True,
                timeout=30,
            )
            if not acquired:
                raise _ServerBusy("The server is busy right now. Please try again in a minute.")
            if job_id not in _jobs:
                # The browser left while this download waited for a slot.
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return

            def _blocking():
                return _download_with_fallback(
                    url, format_id, ext, tmp_dir, [_hook], height, source
                )

            info = await loop.run_in_executor(None, _blocking)

            files = list(Path(tmp_dir).iterdir())
            if not files:
                raise FileNotFoundError("yt-dlp produced no output file")

            out_file = max(files, key=lambda f: f.stat().st_size)
            job = _jobs.get(job_id)
            if not job:
                # The browser left before the end: nobody holds a way to fetch
                # this file, so it is neither kept nor counted.
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return

            # Counting and releasing the slot happen together (see
            # dependencies.DownloadSlots), so a parallel start never slips
            # past the limit in between.
            reserved = False
            try:
                used = await asyncio.to_thread(dependencies.complete_download, user_id)
            except Exception:
                logger.exception("Completed download could not be counted toward the daily limit")
                used = dependencies.used_today(user) + 1
            usage = dependencies.usage_payload(used, limit)

            try:
                await asyncio.to_thread(
                    storage.add_download_log,
                    user_id=user_id,
                    identifier=user.get("identifier") or user.get("email") or "",
                    url=url,
                    title=info.get("title") or "",
                    platform=security.platform_label(platform),
                    quality=_quality_label(ext, height),
                    file_size=out_file.stat().st_size,
                )
            except Exception:
                # The media is already complete; do not take it away from the
                # user, but keep an actionable server-side audit failure.
                logger.exception("Completed download could not be written to the audit log")

            # Unguessable, single-use and tied to this job and account.
            token = secrets.token_urlsafe(32)
            _jobs[f"token:{token}"] = {
                "filename": str(out_file),
                "expires": time.time() + FILE_TOKEN_TTL_SECONDS,
                "job_id": job_id,
                "user_id": user_id,
            }
            job.update({
                "status":   "complete",
                "percent":  100,
                "filename": str(out_file),
                "token":    token,
                "usage":    usage,
                "done":     True,
            })

            async def _expire_unclaimed_file():
                await asyncio.sleep(FILE_TOKEN_TTL_SECONDS)
                entry = _jobs.pop(f"token:{token}", None)
                _jobs.pop(job_id, None)
                if entry:
                    shutil.rmtree(Path(entry["filename"]).parent, ignore_errors=True)

            asyncio.create_task(_expire_unclaimed_file())

        except Exception as exc:
            # A failed download is never served, so its partial files go now.
            shutil.rmtree(tmp_dir, ignore_errors=True)
            job = _jobs.get(job_id)
            if job:
                job.update({
                    "status": "error",
                    "error":  youtube_error_message(url, exc),
                    "done":   True,
                })
                if isinstance(exc, _ServerBusy):
                    job["code"] = "busy"
        finally:
            if acquired:
                _semaphore.release()
            if reserved:
                dependencies.release_download(user_id)

    asyncio.create_task(_run_download())

    # The first event carries the job id and a private resume code, so the
    # page can reconnect to this download if the stream drops (see
    # RESUME_GRACE_SECONDS).
    return _follow_job(job_id, first_event={
        "status": "starting", "percent": 0, "job_id": job_id, "resume": resume_code,
        "speed": "0 KB/s", "eta": "--:--",
        "downloaded_fmt": "0 KB", "total_fmt": "?",
        "downloaded": 0, "total": None,
    })


# ─────────────────────────────────────────────────────────────────────────────
# Token-based file-serve endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/download/file")
async def serve_download_file(token: str = Query(..., min_length=1, max_length=FILE_TOKEN_MAX)):
    """
    Called by the browser immediately after the SSE stream emits 'complete'.
    Serves the temp file once, then schedules deletion.
    """
    entry = _jobs.get(f"token:{token}")

    if not entry:
        raise HTTPException(status_code=404, detail=FILE_GONE_MESSAGE)

    if time.time() > entry["expires"]:
        _jobs.pop(f"token:{token}", None)
        shutil.rmtree(Path(entry["filename"]).parent, ignore_errors=True)
        raise HTTPException(status_code=410, detail=FILE_GONE_MESSAGE)

    filepath = Path(entry["filename"])
    if not filepath.exists():
        _jobs.pop(f"token:{token}", None)
        raise HTTPException(status_code=404, detail=FILE_GONE_MESSAGE)

    # One-time use: remove token immediately
    _jobs.pop(f"token:{token}", None)

    clean_name = _clean_filename(filepath.stem) + filepath.suffix

    async def _cleanup():
        await asyncio.sleep(30)
        try:
            shutil.rmtree(filepath.parent, ignore_errors=True)
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
