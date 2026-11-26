from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.transactions.models import BotTransaction, CurrencyLabel, WebhookTransaction

TEST_EVENT = "transaction.created"
TEST_DELIVERY_ID = 0
TEST_LIFETIME = timedelta(minutes=10)
NO_CURRENCY = UUID(int=0)
TEST_AMOUNT = Decimal(100)
TEST_PAYOUT = Decimal(10)
TEST_CURRENCY = CurrencyLabel(abbreviation="TEST", name="Test", removed=False)

TestPath = Literal["webhook", "feed"]
TestState = Literal["waiting", "delivered", "handled"]
MarkedStatus = Literal["Completed", "Refunded"]

WEBHOOK_PATH: TestPath = "webhook"
FEED_PATH: TestPath = "feed"


@dataclass(frozen=True)
class WebhookTest:
    id: UUID
    bot_id: UUID
    owner_id: str
    submitted_at: datetime

    def payload(self) -> dict[str, Any]:
        transaction = WebhookTransaction(
            id=self.id,
            user_id=self.owner_id,
            from_currency_id=NO_CURRENCY,
            to_currency_id=NO_CURRENCY,
            amount=TEST_AMOUNT,
            payout=TEST_PAYOUT,
            status="Pending",
            submitted_at=self.submitted_at,
            handled_at=None,
        )

        return {"event": TEST_EVENT, "test": True, "transaction": transaction.model_dump(mode="json")}


@dataclass(frozen=True)
class LiveTestLookup:
    test_id: UUID
    bot_id: UUID
    now: datetime

    def parameters(self) -> dict[str, Any]:
        return {"test_id": self.test_id, "bot_id": self.bot_id, "oldest_live": self.now - TEST_LIFETIME}


LIVE_TEST = "t.id = %(test_id)s AND t.bot_id = %(bot_id)s AND t.submitted_at >= %(oldest_live)s"


def record_webhook_test(db: Connection[DictRow], test: WebhookTest) -> None:
    insert_test(db, test, WEBHOOK_PATH, None)


def record_feed_test(db: Connection[DictRow], test: WebhookTest, feed_event_id: int) -> None:
    insert_test(db, test, FEED_PATH, feed_event_id)


def insert_test(db: Connection[DictRow], test: WebhookTest, path: TestPath, feed_event_id: int | None) -> None:
    db.execute(
        """
        INSERT INTO webhook_tests (id, bot_id, owner_id, path, feed_event_id, submitted_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (test.id, test.bot_id, test.owner_id, path, feed_event_id, test.submitted_at),
    )


def delete_test(db: Connection[DictRow], test_id: UUID) -> None:
    db.execute("DELETE FROM webhook_tests WHERE id = %s", (test_id,))


def delete_expired_tests(db: Connection[DictRow], now: datetime) -> None:
    db.execute("DELETE FROM webhook_tests WHERE submitted_at < %s", (now - TEST_LIFETIME,))


def find_live_test_progress(db: Connection[DictRow], lookup: LiveTestLookup) -> dict[str, Any] | None:
    return db.execute(
        f"""
        SELECT t.path, t.marked_status, t.feed_event_id, f.acknowledged_event_id
        FROM webhook_tests t JOIN bot_feeds f ON f.bot_id = t.bot_id
        WHERE {LIVE_TEST}
        """,
        lookup.parameters(),
    ).fetchone()


def state_of(progress: dict[str, Any]) -> TestState:
    if progress["marked_status"] is not None:
        return "handled"

    if progress["path"] == FEED_PATH and progress["acknowledged_event_id"] < progress["feed_event_id"]:
        return "waiting"

    return "delivered"


def lock_live_test(db: Connection[DictRow], lookup: LiveTestLookup) -> dict[str, Any] | None:
    return db.execute(
        f"SELECT t.id, t.marked_status FROM webhook_tests t WHERE {LIVE_TEST} FOR UPDATE", lookup.parameters()
    ).fetchone()


def mark_test(db: Connection[DictRow], test_id: UUID, status: MarkedStatus, now: datetime) -> BotTransaction:
    marked = db.execute(
        """
        UPDATE webhook_tests SET marked_status = %s, marked_at = %s WHERE id = %s
        RETURNING id, owner_id, submitted_at, marked_status, marked_at
        """,
        (status, now, test_id),
    ).fetchone()

    return BotTransaction(
        id=marked["id"],
        user_id=marked["owner_id"],
        from_currency_id=NO_CURRENCY,
        to_currency_id=NO_CURRENCY,
        amount=TEST_AMOUNT,
        payout=TEST_PAYOUT,
        status=marked["marked_status"],
        submitted_at=marked["submitted_at"],
        handled_at=marked["marked_at"],
        from_currency=TEST_CURRENCY,
        to_currency=TEST_CURRENCY,
    )
