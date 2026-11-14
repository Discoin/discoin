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

from app.core.secret_box import SecretBox
from app.transactions.models import BotTransaction

SECRET_PREFIX = "whsec_"
SIGNATURE_HEADER = "Discoin-Signature"
FIRST_RETRY_DELAY = timedelta(seconds=10)
LONGEST_RETRY_DELAY = timedelta(hours=1)
MAX_RETRIES = 10
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
    currency_id: UUID | None = None

    def as_json(self) -> dict[str, str]:
        if self.currency_id is None:
            return {"kind": self.kind}

        return {"kind": self.kind, "currencyId": str(self.currency_id)}


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


def owner_of(currency_id: UUID) -> Trigger:
    return Trigger("owner", currency_id)


def issue_webhook_secret(db: Connection[DictRow], box: SecretBox, currency_id: UUID) -> str:
    secret = SECRET_PREFIX + secrets.token_urlsafe(32)
    db.execute(
        "UPDATE currencies SET webhook_secret_sealed = %s WHERE id = %s",
        (box.seal(secret, str(currency_id)), currency_id),
    )

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
        "transaction": BotTransaction.model_validate(transaction).model_dump(mode="json"),
    }
    if trigger is not None:
        payload["triggeredBy"] = trigger.as_json()

    db.execute(
        """
        INSERT INTO webhook_deliveries (transaction_id, currency_id, event, payload, next_attempt_at)
        SELECT %(transaction_id)s, id, %(event)s, %(payload)s, %(now)s FROM currencies
        WHERE id = %(currency_id)s AND webhook_url IS NOT NULL
        """,
        {
            "transaction_id": transaction["id"],
            "currency_id": transaction["to_currency_id"],
            "event": event,
            "payload": Jsonb(payload),
            "now": now,
        },
    )


def build_test_delivery(currency: dict[str, Any], user_id: str, now: datetime) -> dict[str, Any]:
    transaction = BotTransaction(
        id=uuid7(),
        user_id=user_id,
        from_currency_id=NO_CURRENCY,
        to_currency_id=currency["id"],
        amount=TEST_AMOUNT,
        payout=TEST_PAYOUT,
        status="Pending",
        submitted_at=now,
        handled_at=None,
    )

    return {
        "id": TEST_DELIVERY_ID,
        "currency_id": currency["id"],
        "webhook_url": currency["webhook_url"],
        "webhook_secret_sealed": currency["webhook_secret_sealed"],
        "payload": {"event": TEST_EVENT, "transaction": transaction.model_dump(mode="json")},
    }


def retry_delay(failed_attempts: int) -> timedelta:
    return min(FIRST_RETRY_DELAY * 2 ** (failed_attempts - 1), LONGEST_RETRY_DELAY)


def signature(secret: str, timestamp: int, body: bytes) -> str:
    signed = f"{timestamp}.".encode() + body
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()

    return f"t={timestamp},v1={digest}"


class WebhookSender:
    def __init__(self, http: httpx.Client, box: SecretBox) -> None:
        self.http = http
        self.box = box

    def send(self, delivery: dict[str, Any], now: datetime) -> Outcome:
        if delivery["webhook_url"] is None:
            return Outcome(status=None, error="The webhook URL was removed.")

        try:
            secret = self.box.open(delivery["webhook_secret_sealed"], str(delivery["currency_id"]))
        except (InvalidTag, ValueError) as error:
            return Outcome(status=None, error=f"The webhook secret could not be read: {type(error).__name__}")

        body = json.dumps({"id": delivery["id"], **delivery["payload"]}, separators=(",", ":")).encode()
        headers = {"Content-Type": "application/json", SIGNATURE_HEADER: signature(secret, int(now.timestamp()), body)}
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
            SELECT d.id, d.currency_id, d.payload, d.attempt, c.webhook_url, c.webhook_secret_sealed
            FROM webhook_deliveries d JOIN currencies c ON c.id = d.currency_id
            WHERE d.state = 'pending' AND d.next_attempt_at <= %s
            ORDER BY d.next_attempt_at, d.id
            LIMIT 1
            FOR UPDATE OF d SKIP LOCKED
            """,
            (now,),
        ).fetchone()
        if delivery is None:
            return False

        record_attempt(db, delivery, sender.send(delivery, now), now)

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
