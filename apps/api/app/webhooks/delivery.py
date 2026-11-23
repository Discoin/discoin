import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid7

import httpx
from cryptography.exceptions import InvalidTag
from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from app.bots.feed import add_event, lock_feed
from app.core.secret_box import SecretBox
from app.transactions.models import WebhookTransaction

SECRET_PREFIX = "whsec_"
SIGNATURE_HEADER = "Discoin-Signature"
FIRST_RETRY_DELAY = timedelta(minutes=1)
MAX_RETRIES = 7
ERROR_TEXT_LIMIT = 500

EVENTS = {
    "created": "transaction.created",
    "resend": "transaction.created",
    "cancelled": "transaction.cancelled",
    "reversed": "transaction.reversed",
}


@dataclass(frozen=True)
class Trigger:
    kind: str
    bot_id: UUID | None = None

    def as_json(self) -> dict[str, str]:
        if self.bot_id is None:
            return {"kind": self.kind}

        return {"kind": self.kind, "botId": str(self.bot_id)}


ADMINS = Trigger("admins")

TEST_EVENT = "transaction.test"
TEST_DELIVERY_ID = 0
NO_CURRENCY = UUID(int=0)
TEST_AMOUNT = Decimal(100)
TEST_PAYOUT = Decimal(10)


@dataclass(frozen=True)
class Outcome:
    status: int | None
    error: str | None

    @property
    def succeeded(self) -> bool:
        return self.error is None


def owner_of(bot_id: UUID) -> Trigger:
    return Trigger("owner", bot_id)


def issue_webhook_secret(db: Connection[DictRow], box: SecretBox, bot_id: UUID) -> str:
    secret = SECRET_PREFIX + secrets.token_urlsafe(32)
    db.execute("UPDATE bots SET webhook_secret_sealed = %s WHERE id = %s", (box.seal(secret, str(bot_id)), bot_id))

    return secret


def enqueue_webhook(
    db: Connection[DictRow],
    transaction: dict[str, Any],
    event: str,
    now: datetime,
    trigger: Trigger | None = None,
) -> None:
    payload: dict[str, Any] = {
        "event": EVENTS[event],
        "transaction": WebhookTransaction.model_validate(transaction).model_dump(mode="json"),
    }
    if trigger is not None:
        payload["triggeredBy"] = trigger.as_json()

    receiver = db.execute(
        "SELECT bot_id FROM currencies WHERE id = %s AND removed_at IS NULL AND bot_id IS NOT NULL",
        (transaction["to_currency_id"],),
    ).fetchone()
    if receiver is None:
        return

    lock_feed(db, receiver["bot_id"])

    if not has_webhook_url(db, receiver["bot_id"]):
        add_event(db, receiver["bot_id"], payload, now)

        return

    db.execute(
        """
        INSERT INTO webhook_deliveries (transaction_id, currency_id, event, payload, next_attempt_at)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (transaction["id"], transaction["to_currency_id"], event, Jsonb(payload), now),
    )


def has_webhook_url(db: Connection[DictRow], bot_id: UUID) -> bool:
    # A separate statement on purpose: joined into the locking query, it would read the URL from before the lock came.
    bot = db.execute("SELECT webhook_url IS NOT NULL AS has_webhook_url FROM bots WHERE id = %s", (bot_id,)).fetchone()

    return bot["has_webhook_url"]


def build_test_payload(user_id: str, now: datetime) -> dict[str, Any]:
    transaction = WebhookTransaction(
        id=uuid7(),
        user_id=user_id,
        from_currency_id=NO_CURRENCY,
        to_currency_id=NO_CURRENCY,
        amount=TEST_AMOUNT,
        payout=TEST_PAYOUT,
        status="Pending",
        submitted_at=now,
        handled_at=None,
    )

    return {"event": TEST_EVENT, "transaction": transaction.model_dump(mode="json")}


def drop_pending_deliveries(db: Connection[DictRow], bot_id: UUID, reason: str) -> None:
    db.execute(
        """
        UPDATE webhook_deliveries SET state = 'dropped', last_error = %s
        WHERE state = 'pending' AND currency_id IN (SELECT id FROM currencies WHERE bot_id = %s)
        """,
        (reason, bot_id),
    )


def retry_delay(failed_attempts: int) -> timedelta:
    return FIRST_RETRY_DELAY * 2 ** (failed_attempts - 1)


def signature(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class WebhookSender:
    def __init__(self, http: httpx.Client, box: SecretBox) -> None:
        self.http = http
        self.box = box

    def send(self, delivery: dict[str, Any]) -> Outcome:
        if delivery["webhook_url"] is None:
            return Outcome(status=None, error="The webhook URL was removed.")

        try:
            secret = self.box.open(delivery["webhook_secret_sealed"], str(delivery["bot_id"]))
        except (InvalidTag, ValueError) as error:
            return Outcome(status=None, error=f"The webhook secret could not be read: {type(error).__name__}")

        body = json.dumps({"id": delivery["id"], **delivery["payload"]}, separators=(",", ":")).encode()
        headers = {"Content-Type": "application/json", SIGNATURE_HEADER: signature(secret, body)}
        try:
            response = self.http.post(delivery["webhook_url"], content=body, headers=headers)
        except httpx.HTTPError as error:
            return Outcome(status=None, error=f"{type(error).__name__}: {error}"[:ERROR_TEXT_LIMIT])

        if response.is_success:
            return Outcome(status=response.status_code, error=None)

        return Outcome(status=response.status_code, error=f"HTTP {response.status_code}")


def deliver_due_webhooks(db: Connection[DictRow], sender: WebhookSender, now: datetime) -> int:
    attempted = 0

    while deliver_next(db, sender, now):
        attempted += 1

    return attempted


def deliver_next(db: Connection[DictRow], sender: WebhookSender, now: datetime) -> bool:
    with db.transaction():
        delivery = db.execute(
            """
            SELECT d.id, d.payload, d.attempt, b.id AS bot_id, b.webhook_url, b.webhook_secret_sealed
            FROM webhook_deliveries d
            JOIN currencies c ON c.id = d.currency_id
            JOIN bots b ON b.id = c.bot_id
            WHERE d.state = 'pending' AND d.next_attempt_at <= %s
            ORDER BY d.next_attempt_at, d.id
            LIMIT 1
            FOR UPDATE OF d SKIP LOCKED
            """,
            (now,),
        ).fetchone()
        if delivery is None:
            return False

        record_attempt(db, delivery, sender.send(delivery), now)

    return True


def record_attempt(db: Connection[DictRow], delivery: dict[str, Any], outcome: Outcome, now: datetime) -> None:
    attempts = delivery["attempt"] + 1
    if outcome.succeeded:
        db.execute(
            """
            UPDATE webhook_deliveries
            SET state = 'delivered', attempt = %s, last_status = %s, last_error = NULL, delivered_at = %s
            WHERE id = %s
            """,
            (attempts, outcome.status, now, delivery["id"]),
        )
        return

    retries_used = attempts - 1
    state = "exhausted" if retries_used >= MAX_RETRIES else "pending"
    db.execute(
        """
        UPDATE webhook_deliveries
        SET state = %s, attempt = %s, last_status = %s, last_error = %s, next_attempt_at = %s
        WHERE id = %s
        """,
        (state, attempts, outcome.status, outcome.error, now + retry_delay(attempts), delivery["id"]),
    )
