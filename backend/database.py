# backend/database.py
"""Compatibility shim: download bookkeeping lives in storage.py.

v1 routers imported log_download/record_download from here; v2 records a
completed download with storage.add_download_log (audit row) and
storage.record_user_download (daily quota counter). New code should import
them from storage directly.
"""

from storage import add_download_log, record_user_download

__all__ = ["add_download_log", "record_user_download"]
