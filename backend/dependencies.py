# backend/dependencies.py
# Shared FastAPI dependencies used across routers.

import os
from fastapi import HTTPException, Query
from supabase import create_client, Client
from dotenv import load_dotenv
from pathlib import Path

backend_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=backend_dir / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize(identifier: str) -> str:
    return identifier.strip().lower()


def get_user(identifier: str):
    resp = (
        supabase.table("users")
        .select("*")
        .eq("identifier", normalize(identifier))
        .execute()
    )
    return resp.data[0] if resp.data else None


def require_approved_user(identifier: str = Query(...)):
    """
    FastAPI dependency.  Reads `identifier` from the query string and raises
    403 if the user is not found or not approved.
    Returns the user row so routes can use it if needed.
    """
    user = get_user(identifier)
    if not user or user["status"] != "approved":
        raise HTTPException(status_code=403, detail="Access denied")
    return user