from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

RETENTION = timedelta(hours=24)


def lock_feed(db: Connection[DictRow], bot_id: UUID) -> None:
    db.execute("SELECT 1 FROM bot_feeds WHERE bot_id = %s FOR NO KEY UPDATE", (bot_id,))


def lock_feeds_receiving(db: Connection[DictRow], to_currency_ids: list[UUID]) -> None:
    db.execute(
        """
        SELECT 1 FROM bot_feeds
        WHERE bot_id IN (SELECT bot_id FROM currencies WHERE id = ANY(%s))
        ORDER BY bot_id
        FOR NO KEY UPDATE
        """,
        (to_currency_ids,),
    )


def add_event(db: Connection[DictRow], bot_id: UUID, payload: dict[str, Any], now: datetime) -> None:
    numbered = db.execute(
        "UPDATE bot_feeds SET last_event_id = last_event_id + 1 WHERE bot_id = %s RETURNING last_event_id", (bot_id,)
    ).fetchone()
    db.execute(
        "INSERT INTO bot_events (bot_id, id, event, payload, created_at) VALUES (%s, %s, %s, %s, %s)",
        (bot_id, numbered["last_event_id"], payload["event"], Jsonb(payload), now),
    )


def clear_feed(db: Connection[DictRow], bot_id: UUID) -> None:
    db.execute("UPDATE bot_feeds SET acknowledged_event_id = last_event_id WHERE bot_id = %s", (bot_id,))
    db.execute("DELETE FROM bot_events WHERE bot_id = %s", (bot_id,))


def purge_expired_events(db: Connection[DictRow], now: datetime) -> None:
    expired_before = now - RETENTION

    with db.transaction():
        # Feeds held by another transaction wait for the next purge, so a purge never blocks on a feed being cleared.
        purgeable = db.execute(
            """
            SELECT bot_id FROM bot_feeds
            WHERE bot_id IN (SELECT bot_id FROM bot_events WHERE created_at < %s)
            FOR NO KEY UPDATE SKIP LOCKED
            """,
            (expired_before,),
        ).fetchall()
        db.execute(
            "DELETE FROM bot_events WHERE created_at < %s AND bot_id = ANY(%s)",
            (expired_before, [feed["bot_id"] for feed in purgeable]),
        )
