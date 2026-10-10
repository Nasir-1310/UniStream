"""Which commit is running, for the health check and the admin page."""

import os
from pathlib import Path

_COMMIT_FILE = Path(__file__).resolve().parent / ".commit"


def deployed_commit() -> str:
    """Short commit hash: Render's RENDER_GIT_COMMIT, else the .commit file the
    Hugging Face image writes at build time (huggingface/Dockerfile), else "local"."""
    commit = os.getenv("RENDER_GIT_COMMIT", "").strip()
    if not commit:
        try:
            commit = _COMMIT_FILE.read_text(encoding="utf-8").strip()
        except OSError:
            commit = ""
    return commit[:7] or "local"
