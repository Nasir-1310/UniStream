# backend/routers/feedback.py
#
#   POST /feedback — a signed-in user reports a problem (for example a failed
#                    download, with its link and error) or sends feedback or
#                    an idea. The admin reads them under /admin/feedback.

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

import dependencies
import security
import storage

router = APIRouter(tags=["feedback"])
logger = logging.getLogger(__name__)

# Reports per account and hour: plenty for real problems, not a spam channel.
FEEDBACK_PER_USER = (10, 3600)

NOT_SET_UP_MESSAGE = "Sending feedback isn't available right now. Please try again later."


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["problem", "feedback", "idea"]
    message: str = Field(min_length=1, max_length=storage.MAX_FEEDBACK_MESSAGE)
    # The video link the problem happened with (optional, never fetched).
    url: Optional[str] = Field(None, max_length=security.URL_MAX)
    # Filled in by the page for a failed download: quality and error text.
    details: Optional[str] = Field(None, max_length=storage.MAX_FEEDBACK_DETAILS)

    @field_validator("message", "url", "details", mode="before")
    @classmethod
    def _strip(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("message")
    @classmethod
    def _not_blank(cls, value: str):
        if len(value) < 3:
            raise ValueError("Please write a few words about it.")
        return value


@router.post("/feedback", status_code=201)
def send_feedback(body: FeedbackRequest, user: dict = Depends(dependencies.require_user)):
    dependencies.limit_rule(
        "feedback", user["id"], FEEDBACK_PER_USER,
        "You've sent a lot of reports this hour. Try again in {wait}.",
    )
    try:
        storage.add_feedback(
            user_id=user["id"],
            identifier=user.get("identifier") or user.get("email") or "",
            kind=body.kind,
            message=body.message,
            url=body.url or None,
            details=body.details or None,
        )
    except storage.SchemaOutdatedError:
        # The optional feedback table hasn't been created in Supabase yet.
        logger.warning("Feedback was refused: run backend/sql/feedback.sql in Supabase")
        raise HTTPException(status_code=503, detail=NOT_SET_UP_MESSAGE) from None
    return {"sent": True, "message": "Thanks! Your message reached the UniStream team."}
