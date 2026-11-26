import ipaddress
from decimal import Decimal
from typing import Annotated, Any
from urllib.parse import urlsplit
from uuid import UUID, uuid7

from fastapi import APIRouter, Depends, Request
from psycopg import sql

from app.auth.sessions import LoggedInUser
from app.bots.feed import add_event, clear_feed, lock_feed
from app.bots.tokens import issue_api_token
from app.core.database import Database, Now
from app.core.errors import ApiError, not_found
from app.core.models import CamelModel, JsonDecimal
from app.core.validation import checked_amount
from app.currencies.models import Currency
from app.currencies.queries import (
    checked_details,
    claiming_abbreviation,
    find_currency_by_id,
    list_owned_currency_rows,
    to_currency,
)
from app.owners.access import (
    BotOwnership,
    OwnedBot,
    OwnedBotForWrite,
    OwnedCurrency,
    OwnedCurrencyForWrite,
    lock_owned_bot,
    require_owner,
)
from app.transactions.models import BotTransaction
from app.transactions.queries import list_pending_into_bot
from app.webhooks.delivery import Outcome, WebhookSender, enqueue_webhook, issue_webhook_secret
from app.webhooks.webhook_tests import (
    FEED_PATH,
    TEST_DELIVERY_ID,
    WEBHOOK_PATH,
    LiveTestLookup,
    MarkedStatus,
    TestPath,
    TestState,
    WebhookTest,
    delete_test,
    find_live_test_progress,
    record_feed_test,
    record_webhook_test,
    state_of,
)

CURRENCY_ID = "currency_id"

router = APIRouter(tags=["bot owners"])


class WebhookSecret(CamelModel):
    secret: str


@router.post("/bots/{bot_id}/webhook-secret")
def regenerate_webhook_secret(owned: OwnedBotForWrite, request: Request, db: Database) -> WebhookSecret:
    return WebhookSecret(secret=issue_webhook_secret(db, request.app.state.secret_box, owned.bot_id))


def webhook_sender(request: Request) -> WebhookSender:
    return request.app.state.webhook_sender


class StartedWebhookTest(CamelModel):
    test_id: UUID
    path: TestPath


class WebhookTestProgress(CamelModel):
    state: TestState
    path: TestPath
    marked_status: MarkedStatus | None


@router.post("/bots/{bot_id}/webhook-test", status_code=202)
def send_test_webhook(
    owned: OwnedBot,
    sender: Annotated[WebhookSender, Depends(webhook_sender)],
    db: Database,
    now: Now,
) -> StartedWebhookTest:
    test = WebhookTest(id=uuid7(), bot_id=owned.bot_id, owner_id=owned.owner_id, submitted_at=now)

    webhook = find_webhook_locking_a_missing_url(db, owned)
    if webhook["webhook_url"] is None:
        record_feed_test(db, test, add_event(db, owned.bot_id, test.payload(), now))

        return StartedWebhookTest(test_id=test.id, path=FEED_PATH)

    record_webhook_test(db, test)
    # Committed before sending, so a bot that marks the test while it handles the webhook finds the test.
    db.commit()

    outcome = sender.send({"id": TEST_DELIVERY_ID, **webhook, "payload": test.payload()})
    if not outcome.succeeded:
        delete_test(db, test.id)
        # Committed here because the error below rolls back the rest of the request.
        db.commit()

        raise webhook_test_failure(outcome)

    return StartedWebhookTest(test_id=test.id, path=WEBHOOK_PATH)


def webhook_test_failure(outcome: Outcome) -> ApiError:
    if outcome.status is None:
        return ApiError(502, f"Discoin couldn't reach your webhook. {outcome.error}")

    return ApiError(502, f"Your webhook answered {outcome.status}. Discoin expects a 2xx answer.")


@router.get("/bots/{bot_id}/webhook-test/{test_id}")
def get_webhook_test(test_id: UUID, owned: OwnedBot, db: Database, now: Now) -> WebhookTestProgress:
    progress = find_live_test_progress(db, LiveTestLookup(test_id=test_id, bot_id=owned.bot_id, now=now))
    if progress is None:
        raise not_found("webhook test")

    return WebhookTestProgress(state=state_of(progress), path=progress["path"], marked_status=progress["marked_status"])


def find_webhook_locking_a_missing_url(db: Database, owned: BotOwnership) -> dict[str, Any]:
    webhook = find_webhook(db, owned.bot_id)
    if webhook["webhook_url"] is not None:
        return webhook

    # The bot's row is locked only when the first read finds no URL, so a test of a saved webhook takes no lock.
    lock_owned_bot(db, owned)

    return find_webhook(db, owned.bot_id)


def find_webhook(db: Database, bot_id: UUID) -> dict[str, Any]:
    return db.execute(
        "SELECT id AS bot_id, webhook_url, webhook_secret_sealed FROM bots WHERE id = %s", (bot_id,)
    ).fetchone()


@router.post("/transactions/{transaction_id}/resend-webhook", status_code=204)
def resend_webhook(transaction_id: UUID, user: LoggedInUser, db: Database, now: Now) -> None:
    destination = db.execute("SELECT to_currency_id FROM transactions WHERE id = %s", (transaction_id,)).fetchone()
    if destination is None:
        raise not_found("transaction")

    lock_owned_bot(db, require_owner(db, destination["to_currency_id"], user.id))

    transaction = db.execute(
        """
        SELECT id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at
        FROM transactions
        WHERE id = %s
        FOR UPDATE
        """,
        (transaction_id,),
    ).fetchone()
    if transaction["status"] != "Pending":
        raise ApiError(400, "Only Pending transactions can be resent.")

    enqueue_webhook(db, transaction, "resend", now)


class BotWithCurrencies(CamelModel):
    id: UUID
    name: str
    currencies: list[Currency]


class BotSettings(CamelModel):
    has_api_token: bool
    has_webhook_secret: bool
    webhook_url: str | None


class CurrencySettings(CamelModel):
    daily_cap: JsonDecimal | None


class DetailsUpdate(CamelModel):
    name: str
    abbreviation: str


class ApiToken(CamelModel):
    token: str


class WebhookUrlUpdate(CamelModel):
    webhook_url: str


class DailyCapUpdate(CamelModel):
    daily_cap: Decimal


@router.get("/owner/bots")
def get_owned_bots(user: LoggedInUser, db: Database, now: Now) -> list[BotWithCurrencies]:
    bots = db.execute(
        "SELECT id, name FROM bots WHERE owner_id = %s AND removed_at IS NULL ORDER BY name, id", (user.id,)
    ).fetchall()
    currencies = list_owned_currency_rows(db, user.id, now)

    return [
        BotWithCurrencies(
            id=bot["id"],
            name=bot["name"],
            currencies=[to_currency(row) for row in currencies if row["bot_id"] == bot["id"]],
        )
        for bot in bots
    ]


@router.get("/bots/{bot_id}/settings")
def get_bot_settings(owned: OwnedBot, db: Database) -> BotSettings:
    row = db.execute(
        """
        SELECT api_token_hash IS NOT NULL AS has_api_token, webhook_secret_sealed IS NOT NULL AS has_webhook_secret,
            webhook_url
        FROM bots WHERE id = %s
        """,
        (owned.bot_id,),
    ).fetchone()

    return BotSettings.model_validate(row)


@router.get("/currencies/{currency_id}/settings")
def get_settings(owned: OwnedCurrency, db: Database) -> CurrencySettings:
    row = db.execute("SELECT daily_cap FROM currencies WHERE id = %s", (owned.currency_id,)).fetchone()

    return CurrencySettings.model_validate(row)


@router.patch("/currencies/{currency_id}")
def update_details(owned: OwnedCurrencyForWrite, body: DetailsUpdate, db: Database, now: Now) -> Currency:
    details = checked_details(db, body.name, body.abbreviation, owned.currency_id)
    with claiming_abbreviation(details.abbreviation):
        update_currency_columns(db, owned.currency_id, {"name": details.name, "abbreviation": details.abbreviation})

    return find_currency_by_id(db, owned.currency_id, now)


@router.post("/bots/{bot_id}/api-token")
def regenerate_api_token(owned: OwnedBotForWrite, db: Database) -> ApiToken:
    return ApiToken(token=issue_api_token(db, owned.bot_id))


@router.put("/bots/{bot_id}/webhook-url", status_code=204)
def set_webhook_url(owned: OwnedBotForWrite, body: WebhookUrlUpdate, db: Database) -> None:
    url = checked_webhook_url(body.webhook_url)

    lock_feed(db, owned.bot_id)

    updated = db.execute(
        "UPDATE bots SET webhook_url = %s WHERE id = %s AND webhook_secret_sealed IS NOT NULL RETURNING id",
        (url, owned.bot_id),
    ).fetchone()
    if updated is None:
        raise ApiError(400, "Generate a webhook secret first, so Discoin can sign each webhook.", "webhookUrl")

    clear_feed(db, owned.bot_id)


@router.delete("/bots/{bot_id}/webhook-url", status_code=204)
def remove_webhook_url(owned: OwnedBotForWrite, db: Database) -> None:
    lock_feed(db, owned.bot_id)
    db.execute("UPDATE bots SET webhook_url = NULL WHERE id = %s", (owned.bot_id,))


@router.put("/currencies/{currency_id}/daily-cap", status_code=204)
def set_daily_cap(owned: OwnedCurrencyForWrite, body: DailyCapUpdate, db: Database) -> None:
    cap = checked_amount(body.daily_cap, "dailyCap", "daily cap")
    update_currency_columns(db, owned.currency_id, {"daily_cap": cap})


@router.delete("/currencies/{currency_id}/daily-cap", status_code=204)
def remove_daily_cap(owned: OwnedCurrencyForWrite, db: Database) -> None:
    update_currency_columns(db, owned.currency_id, {"daily_cap": None})


def update_currency_columns(db: Database, currency_id: UUID, columns: dict[str, object]) -> None:
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(name), sql.Placeholder(name)) for name in columns
    )
    statement = sql.SQL("UPDATE currencies SET {} WHERE id = {}").format(assignments, sql.Placeholder(CURRENCY_ID))
    db.execute(statement, {**columns, CURRENCY_ID: currency_id})


@router.get("/bots/{bot_id}/transactions/pending")
def get_pending_transactions(owned: OwnedBot, db: Database) -> list[BotTransaction]:
    return list_pending_into_bot(db, owned.bot_id)


def checked_webhook_url(value: str) -> str:
    trimmed = value.strip()
    parts = urlsplit(trimmed)
    if parts.scheme != "https" or not parts.hostname:
        raise ApiError(400, "Enter a full https:// URL, like https://bot.example.com/discoin.", "webhookUrl")

    if is_private_host(parts.hostname):
        raise ApiError(400, "Use a public address. Discoin can't send webhooks to private networks.", "webhookUrl")

    return trimmed


def is_private_host(hostname: str) -> bool:
    if hostname == "localhost" or hostname.endswith(".localhost"):
        return True

    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False

    return not address.is_global
