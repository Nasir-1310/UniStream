# backend/dependencies.py
# Shared FastAPI dependencies used across routers.

from fastapi import HTTPException, Query

from storage import get_user, normalize


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