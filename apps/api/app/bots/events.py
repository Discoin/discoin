from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.bots.tokens import CallingBotId
from app.core.database import Database
from app.core.errors import ApiError
from app.core.models import CamelModel

MAX_EVENTS = 100
LONGEST_ID_DIGITS = 18
EVENTS_GO_TO_THE_WEBHOOK = (
    "This bot has a webhook URL, so its events go to the webhook. "
    "Remove the URL on the Bot owner page to read events here."
)

router = APIRouter(prefix="/events", tags=["bots"])


class EventBatch(CamelModel):
    events: list[dict[str, Any]]


class Acknowledgement(CamelModel):
    id: int


def feed_bot_id(bot: CallingBotId, db: Database) -> UUID:
    row = db.execute("SELECT webhook_url FROM bots WHERE id = %s", (bot,)).fetchone()
    if row["webhook_url"] is not None:
        raise ApiError(409, EVENTS_GO_TO_THE_WEBHOOK)

    return bot


FeedBotId = Annotated[UUID, Depends(feed_bot_id)]


@router.get("")
def get_events(bot: FeedBotId, db: Database, after: str | None = None, limit: str | None = None) -> EventBatch:
    rows = db.execute(
        """
        SELECT id, payload FROM bot_events
        WHERE bot_id = %(bot_id)s AND id > coalesce(
            %(after)s, (SELECT acknowledged_event_id FROM bot_feeds WHERE bot_id = %(bot_id)s)
        )
        ORDER BY id
        LIMIT %(limit)s
        """,
        {
            "bot_id": bot,
            "after": None if after is None else whole_number(after, "after"),
            "limit": MAX_EVENTS if limit is None else checked_limit(limit),
        },
    ).fetchall()

    return EventBatch(events=[{"id": row["id"], **row["payload"]} for row in rows])


@router.post("/ack", status_code=204)
def acknowledge_events(body: Acknowledgement, bot: FeedBotId, db: Database) -> None:
    moved = db.execute(
        """
        UPDATE bot_feeds SET acknowledged_event_id = greatest(acknowledged_event_id, %(id)s)
        WHERE bot_id = %(bot_id)s AND %(id)s <= last_event_id
        RETURNING bot_id
        """,
        {"bot_id": bot, "id": body.id},
    ).fetchone()
    if moved is None:
        raise ApiError(400, "That ID is above your bot's newest event. Acknowledge an ID you have read.", "id")


def whole_number(raw: str, field: str) -> int:
    if not (raw.isascii() and raw.isdigit() and len(raw) <= LONGEST_ID_DIGITS):
        raise ApiError(422, f"{field} must be a whole number, 0 or above.", field)

    return int(raw)


def checked_limit(raw: str) -> int:
    limit = whole_number(raw, "limit")
    if not 1 <= limit <= MAX_EVENTS:
        raise ApiError(422, f"limit must be between 1 and {MAX_EVENTS}.", "limit")

    return limit
