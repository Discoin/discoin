from datetime import datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import StrictBool

from app.bots.tokens import CallingBotId
from app.core.database import Database, Now
from app.core.errors import ApiError, not_found
from app.core.models import CamelModel
from app.webhooks.delivery import MAX_RETRIES, retry_delay

MAX_EVENTS = 100
LONGEST_LIMIT_DIGITS = 18
LEASE = timedelta(minutes=2)
LAST_TRY = MAX_RETRIES + 1
EVENTS_GO_TO_THE_WEBHOOK = (
    "This bot has a webhook URL, so its events go to the webhook. "
    "Remove the URL on the Bot owner page to read events here."
)
CLAIM_FIRST = "Claim this event before reporting it."
ALREADY_FINISHED = "This event is already finished."

router = APIRouter(prefix="/events", tags=["bots"])


class EventBatch(CamelModel):
    events: list[dict[str, Any]]


class EventResult(CamelModel):
    handled: StrictBool


def feed_bot_id(bot: CallingBotId, db: Database) -> UUID:
    row = db.execute("SELECT webhook_url FROM bots WHERE id = %s", (bot,)).fetchone()
    if row["webhook_url"] is not None:
        raise ApiError(409, EVENTS_GO_TO_THE_WEBHOOK)

    return bot


FeedBotId = Annotated[UUID, Depends(feed_bot_id)]


@router.post("/claim")
def claim_events(bot: FeedBotId, db: Database, now: Now, limit: str | None = None) -> EventBatch:
    batch_size = MAX_EVENTS if limit is None else checked_limit(limit)
    due = {"bot_id": bot, "now": now, "last_try": LAST_TRY}
    bury_events_out_of_tries(db, due)
    claimed = db.execute(
        """
        WITH due AS (
            SELECT id FROM bot_events
            WHERE bot_id = %(bot_id)s AND state = 'pending' AND next_attempt_at <= %(now)s AND attempt < %(last_try)s
            ORDER BY id
            LIMIT %(limit)s
            FOR UPDATE SKIP LOCKED
        ), claimed AS (
            UPDATE bot_events e
            SET attempt = e.attempt + 1,
                next_attempt_at = %(now)s + %(lease)s + (%(delays_by_attempt)s::interval[])[e.attempt + 1]
            FROM due
            WHERE e.bot_id = %(bot_id)s AND e.id = due.id
            RETURNING e.id, e.attempt, e.payload
        )
        SELECT id, attempt, payload FROM claimed ORDER BY id
        """,
        {
            **due,
            "limit": batch_size,
            "lease": LEASE,
            "delays_by_attempt": [retry_delay(attempt) for attempt in range(1, LAST_TRY + 1)],
        },
    ).fetchall()

    return EventBatch(events=[{"id": row["id"], "attempt": row["attempt"], **row["payload"]} for row in claimed])


def bury_events_out_of_tries(db: Connection[DictRow], due: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE bot_events SET state = 'dead'
        WHERE bot_id = %(bot_id)s AND id IN (
            SELECT id FROM bot_events
            WHERE bot_id = %(bot_id)s AND state = 'pending' AND next_attempt_at <= %(now)s AND attempt >= %(last_try)s
            FOR UPDATE SKIP LOCKED
        )
        """,
        due,
    )


@router.post("/{event_id}/result", status_code=204)
def report_event_result(event_id: int, body: EventResult, bot: FeedBotId, db: Database, now: Now) -> None:
    event = lock_claimed_event(db, bot, event_id)

    if body.handled:
        set_state(db, event, "handled")
    else:
        retry_or_bury(db, event, now)


def lock_claimed_event(db: Connection[DictRow], bot_id: UUID, event_id: int) -> dict[str, Any]:
    event = db.execute(
        "SELECT bot_id, id, state, attempt FROM bot_events WHERE bot_id = %s AND id = %s FOR UPDATE",
        (bot_id, event_id),
    ).fetchone()
    if event is None:
        raise not_found("event")

    if event["state"] == "pending" and event["attempt"] == 0:
        raise ApiError(409, CLAIM_FIRST)

    return event


def retry_or_bury(db: Connection[DictRow], event: dict[str, Any], now: datetime) -> None:
    if event["state"] != "pending":
        raise ApiError(409, ALREADY_FINISHED)

    if event["attempt"] >= LAST_TRY:
        set_state(db, event, "dead")

        return

    db.execute(
        "UPDATE bot_events SET next_attempt_at = %s WHERE bot_id = %s AND id = %s",
        (now + retry_delay(event["attempt"]), event["bot_id"], event["id"]),
    )


def set_state(db: Connection[DictRow], event: dict[str, Any], state: str) -> None:
    db.execute("UPDATE bot_events SET state = %s WHERE bot_id = %s AND id = %s", (state, event["bot_id"], event["id"]))


def checked_limit(raw: str) -> int:
    is_short_whole_number = raw.isascii() and raw.isdigit() and len(raw) <= LONGEST_LIMIT_DIGITS
    if not (is_short_whole_number and 1 <= int(raw) <= MAX_EVENTS):
        raise ApiError(422, f"limit must be between 1 and {MAX_EVENTS}.", "limit")

    return int(raw)
