import ipaddress
from decimal import Decimal
from typing import Annotated
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from psycopg import sql

from app.auth.sessions import LoggedInUser
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
    OwnedBot,
    OwnedBotForWrite,
    OwnedCurrency,
    OwnedCurrencyForWrite,
    lock_owned_bot,
    require_owner,
)
from app.transactions.models import BotTransaction
from app.transactions.queries import list_pending_into_bot
from app.webhooks.delivery import WebhookSender, build_test_delivery, enqueue_webhook, issue_webhook_secret

CURRENCY_ID = "currency_id"

router = APIRouter(tags=["bot owners"])


class WebhookSecret(CamelModel):
    secret: str


@router.post("/bots/{bot_id}/webhook-secret")
def regenerate_webhook_secret(owned: OwnedBotForWrite, request: Request, db: Database) -> WebhookSecret:
    return WebhookSecret(secret=issue_webhook_secret(db, request.app.state.secret_box, owned.bot_id))


def webhook_sender(request: Request) -> WebhookSender:
    return request.app.state.webhook_sender


class WebhookTestResult(CamelModel):
    status: int


@router.post("/bots/{bot_id}/webhook-test")
def send_test_webhook(
    owned: OwnedBot,
    sender: Annotated[WebhookSender, Depends(webhook_sender)],
    db: Database,
    now: Now,
) -> WebhookTestResult:
    webhook = db.execute(
        "SELECT id AS bot_id, webhook_url, webhook_secret_sealed FROM bots WHERE id = %s", (owned.bot_id,)
    ).fetchone()
    if webhook["webhook_url"] is None:
        raise ApiError(400, "Save a webhook URL before sending a test.", "webhookUrl")

    delivery = build_test_delivery(webhook, owned.owner_id, now)

    outcome = sender.send(delivery)
    if outcome.status is None:
        raise ApiError(502, f"Discoin couldn't reach your webhook. {outcome.error}")

    if not outcome.succeeded:
        raise ApiError(502, f"Your webhook answered {outcome.status}. Discoin expects a 2xx answer.")

    return WebhookTestResult(status=outcome.status)


@router.post("/transactions/{transaction_id}/resend-webhook", status_code=204)
def resend_webhook(transaction_id: UUID, user: LoggedInUser, db: Database, now: Now) -> None:
    destination = db.execute("SELECT to_currency_id FROM transactions WHERE id = %s", (transaction_id,)).fetchone()
    if destination is None:
        raise not_found("transaction")

    lock_owned_bot(db, require_owner(db, destination["to_currency_id"], user.id))

    transaction = db.execute(
        """
        SELECT t.id, t.user_id, t.from_currency_id, t.to_currency_id, t.amount, t.payout, t.status,
            t.submitted_at, t.handled_at, b.webhook_url
        FROM transactions t
        JOIN currencies c ON c.id = t.to_currency_id
        JOIN bots b ON b.id = c.bot_id
        WHERE t.id = %s
        FOR UPDATE OF t
        """,
        (transaction_id,),
    ).fetchone()
    if transaction["status"] != "Pending":
        raise ApiError(400, "Only Pending transactions can be resent.")

    if transaction["webhook_url"] is None:
        raise ApiError(400, "Add a webhook URL before resending. Your bot can still poll for this transaction.")

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

    updated = db.execute(
        "UPDATE bots SET webhook_url = %s WHERE id = %s AND webhook_secret_sealed IS NOT NULL RETURNING id",
        (url, owned.bot_id),
    ).fetchone()
    if updated is None:
        raise ApiError(400, "Generate a webhook secret first, so Discoin can sign each webhook.", "webhookUrl")


@router.delete("/bots/{bot_id}/webhook-url", status_code=204)
def remove_webhook_url(owned: OwnedBotForWrite, db: Database) -> None:
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
