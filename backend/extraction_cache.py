"""In-memory cache that spares repeat yt-dlp extractions.

A YouTube extraction on Render's free tier is slow: it fetches the watch page
and runs deno to solve YouTube's JS challenges on a tenth of a CPU. The
/video-info response is kept so analysing the same video again is instant,
and the extracted info is kept so the download that follows can start from it
instead of extracting a second time, the way yt-dlp's --load-info-json does.

Stream URLs expire after about six hours and are bound to this server's IP;
entries live far shorter than that.
"""

import copy
import threading
import time
from collections import OrderedDict

_TTL_SECONDS = 20 * 60
_MAX_ENTRIES = 32

# Not needed to download the media, and automatic captions alone can be
# hundreds of kilobytes per video.
_UNUSED_INFO_KEYS = ("automatic_captions", "subtitles", "thumbnails", "heatmap")

_lock = threading.Lock()
_entries: "OrderedDict[str, dict]" = OrderedDict()


def _live_entry(key: str) -> dict | None:
    entry = _entries.get(key)
    if entry is None:
        return None
    if time.monotonic() - entry["stored_at"] > _TTL_SECONDS:
        del _entries[key]
        return None
    _entries.move_to_end(key)
    return entry


def store(key: str, payload: dict, source: str | None, info: dict | None):
    """Keep a /video-info payload and the sanitized info it was built from."""
    if info is not None:
        info = {k: v for k, v in info.items() if k not in _UNUSED_INFO_KEYS}
    with _lock:
        _entries[key] = {
            "payload": copy.deepcopy(payload),
            "source": source,
            "info": info,
            "stored_at": time.monotonic(),
        }
        _entries.move_to_end(key)
        while len(_entries) > _MAX_ENTRIES:
            _entries.popitem(last=False)


def payload(key: str) -> dict | None:
    with _lock:
        entry = _live_entry(key)
        return copy.deepcopy(entry["payload"]) if entry else None


def info(key: str, source: str | None) -> dict | None:
    """The cached info for a download, if it came from the same attempt.

    A copy is returned because yt-dlp fills in the info dict while it
    downloads, and two people may download the same video at once.
    """
    with _lock:
        entry = _live_entry(key)
        if not entry or entry["info"] is None or entry["source"] != source:
            return None
        return copy.deepcopy(entry["info"])


def discard_info(key: str):
    """Stop offering an info whose stream URLs just failed to download."""
    with _lock:
        entry = _entries.get(key)
        if entry is not None:
            entry["info"] = None


def clear():
    with _lock:
        _entries.clear()
