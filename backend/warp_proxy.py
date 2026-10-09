"""Free Cloudflare WARP exit for YouTube traffic (opt-in: YOUTUBE_WARP=true).

YouTube refuses Render's data-centre IP outright ("Failed to extract any
player response" for every client, cookies or not). WARP is Cloudflare's free
WireGuard VPN; wireproxy runs it in user space as a local SOCKS5 proxy, so
only yt-dlp's YouTube traffic leaves through Cloudflare's IP while everything
else keeps the server's own address. One tunnel keeps one exit IP, which
YouTube's IP-bound stream links need.

On first use the two tools are downloaded from their GitHub releases and
checked against pinned SHA-256 digests, a free WARP account is registered
with wgcf, and wireproxy is started. Everything lives in the temp directory,
so a restarted instance simply sets it up again. Whether YouTube accepts a
WARP IP is up to YouTube; YOUTUBE_PROXY, when set, always wins.
"""

import hashlib
import io
import logging
import os
import platform
import socket
import subprocess
import tarfile
import tempfile
import threading
import time
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

_WGCF = (
    "https://github.com/ViRb3/wgcf/releases/download/v2.3.0/wgcf_2.3.0_linux_amd64",
    "01614e38c0eb5f3405232e71cfaf02d64d4809e4988ad8f5a8071af16d193405",
)
_WIREPROXY = (
    "https://github.com/windtf/wireproxy/releases/download/v1.1.3/wireproxy_linux_amd64.tar.gz",
    "e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c",
)

_HOST, _PORT = "127.0.0.1", 40000
_DIR = Path(tempfile.gettempdir()) / "unistream-warp"

_lock = threading.Lock()
_state = {"status": "off", "detail": None}
_process: subprocess.Popen | None = None


def enabled() -> bool:
    return os.getenv("YOUTUBE_WARP", "").strip().lower() in ("1", "true", "yes", "on")


def proxy_url() -> str | None:
    """The SOCKS5 proxy for YouTube once WARP is up, else None."""
    with _lock:
        ready = _state["status"] == "ready" and _process is not None and _process.poll() is None
    return f"socks5://{_HOST}:{_PORT}" if ready else None


def status() -> str:
    """"off", "starting", "ready" or "failed: <reason>" for the admin page."""
    with _lock:
        if _state["status"] == "ready" and (_process is None or _process.poll() is not None):
            return "failed: wireproxy stopped"
        detail = _state["detail"]
        return f"{_state['status']}: {detail}" if detail else _state["status"]


def _set(status: str, detail: str | None = None):
    with _lock:
        _state.update(status=status, detail=detail)


def _download(url: str, digest: str) -> bytes:
    data = httpx.get(url, follow_redirects=True, timeout=120).raise_for_status().content
    if hashlib.sha256(data).hexdigest() != digest:
        raise RuntimeError(f"checksum mismatch for {url.rsplit('/', 1)[-1]}")
    return data


def _install(name: str, data: bytes) -> Path:
    path = _DIR / name
    path.write_bytes(data)
    path.chmod(0o700)
    return path


def _wait_for_port(seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with socket.socket() as probe:
            probe.settimeout(1)
            if probe.connect_ex((_HOST, _PORT)) == 0:
                return True
        if _process is not None and _process.poll() is not None:
            return False
        time.sleep(0.5)
    return False


def _start():
    global _process
    _DIR.mkdir(mode=0o700, exist_ok=True)

    wgcf = _DIR / "wgcf"
    if not wgcf.is_file():
        wgcf = _install("wgcf", _download(*_WGCF))
    wireproxy = _DIR / "wireproxy"
    if not wireproxy.is_file():
        archive = tarfile.open(fileobj=io.BytesIO(_download(*_WIREPROXY)))
        member = next(m for m in archive.getmembers() if m.isfile() and m.name.endswith("wireproxy"))
        wireproxy = _install("wireproxy", archive.extractfile(member).read())

    def run(*args):
        result = subprocess.run(
            [str(wgcf), *args], cwd=_DIR, capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(f"wgcf {args[0]} failed: {(result.stderr or result.stdout).strip()[:200]}")

    if not (_DIR / "wgcf-account.toml").is_file():
        run("register", "--accept-tos")
    if not (_DIR / "wgcf-profile.conf").is_file():
        run("generate")

    config = _DIR / "wireproxy.conf"
    config.write_text(
        f"WGConfig = {_DIR / 'wgcf-profile.conf'}\n\n[Socks5]\nBindAddress = {_HOST}:{_PORT}\n"
    )
    log = open(_DIR / "wireproxy.log", "ab")
    _process = subprocess.Popen(
        [str(wireproxy), "-c", str(config)], cwd=_DIR, stdout=log, stderr=subprocess.STDOUT,
    )
    if not _wait_for_port(30):
        raise RuntimeError("wireproxy did not start (see wireproxy.log)")


def _start_safely():
    try:
        _start()
    except Exception as exc:
        logger.warning("Cloudflare WARP for YouTube could not start: %s", exc)
        _set("failed", str(exc)[:200])
        return
    _set("ready")
    logger.warning("Cloudflare WARP is up: YouTube traffic now leaves through Cloudflare")


def start_in_background():
    """Start WARP once, without delaying the server's start-up."""
    if not enabled():
        return
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "AMD64"):
        _set("failed", "WARP is only set up on Linux x86-64 hosts such as Render")
        return
    with _lock:
        if _state["status"] != "off":
            return
        _state.update(status="starting", detail=None)
    threading.Thread(target=_start_safely, name="warp-start", daemon=True).start()
