# backend/database.py
# Thin async-friendly wrappers around Supabase operations used by routers.

import os
from dotenv import load_dotenv
from pathlib import Path
from supabase import create_client, Client

backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


async def log_download(identifier: str, url: str, title: str = "", platform: str = "") -> None:
    """
    Insert a row into download_logs.  Called fire-and-forget — errors are
    swallowed so they never abort an in-progress download.
    """
    try:
        supabase.table("download_logs").insert(
            {
                "identifier": identifier.strip().lower(),
                "url": url,
                "title": title,
                "platform": platform,
            }
        ).execute()
    except Exception:
        pass  # Non-critical; logging failure must not surface to the user