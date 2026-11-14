import ipaddress
from decimal import Decimal
from typing import Annotated
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.auth.sessions import LoggedInUser
from app.bots.tokens import issue_api_token
from app.core.database import Database, Now
from app.core.errors import ApiError, not_found
from app.core.models import CamelModel, JsonDecimal
from app.core.validation import checked_amount
from app.currencies.models import Currency
from app.currencies.queries import checked_details, find_currency_by_id, list_owned_currencies
from app.owners.access import OwnedCurrencyId, require_owner
from app.transactions.models import BotTransaction
from app.transactions.queries import list_pending_for
from app.webhooks.delivery import WebhookSender, build_test_delivery, enqueue_webhook, issue_webhook_secret

router = APIRouter(tags=["bot owners"])


class WebhookSecret(CamelModel):
    secret: str


@router.post("/currencies/{currency_id}/webhook-secret")
def regenerate_webhook_secret(currency_id: OwnedCurrencyId, request: Request, db: Database) -> WebhookSecret:
    return WebhookSecret(secret=issue_webhook_secret(db, request.app.state.secret_box, currency_id))


def webhook_sender(request: Request) -> WebhookSender:
    return request.app.state.webhook_sender


class WebhookTestResult(CamelModel):
    status: int


@router.post("/currencies/{currency_id}/webhook-test")
def send_test_webhook(
    currency_id: OwnedCurrencyId,
    user: LoggedInUser,
    sender: Annotated[WebhookSender, Depends(webhook_sender)],
    db: Database,
    now: Now,
) -> WebhookTestResult:
    currency = db.execute(
        "SELECT id, webhook_url, webhook_secret_sealed FROM currencies WHERE id = %s", (currency_id,)
    ).fetchone()
    if currency["webhook_url"] is None:
        raise ApiError(400, "Save a webhook URL before sending a test.", "webhookUrl")

    outcome = sender.send(build_test_delivery(currency, user.id, now), now)
    if outcome.status is None:
        raise ApiError(502, f"Discoin couldn't reach your webhook. {outcome.error}")

    if not outcome.succeeded:
        raise ApiError(502, f"Your webhook answered {outcome.status}. Discoin expects a 2xx answer.")

    return WebhookTestResult(status=outcome.status)


@router.post("/transactions/{transaction_id}/resend-webhook", status_code=204)
def resend_webhook(transaction_id: UUID, user: LoggedInUser, db: Database, now: Now) -> None:
    transaction = db.execute(
        """
        SELECT t.id, t.user_id, t.from_currency_id, t.to_currency_id, t.amount, t.payout, t.status,
            t.submitted_at, t.handled_at, c.webhook_url
        FROM transactions t JOIN currencies c ON c.id = t.to_currency_id
        WHERE t.id = %s
        """,
        (transaction_id,),
    ).fetchone()
    if transaction is None:
        raise not_found("transaction")

    require_owner(db, transaction["to_currency_id"], user.id)

    if transaction["status"] != "Pending":
        raise ApiError(400, "Only Pending transactions can be resent.")

    if transaction["webhook_url"] is None:
        raise ApiError(400, "Add a webhook URL before resending. Your bot can still poll for this transaction.")

    enqueue_webhook(db, transaction, "resend", now)


class CurrencySettings(CamelModel):
    has_api_token: bool
    has_webhook_secret: bool
    webhook_url: str | None
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


@router.get("/owner/currencies")
def get_owned_currencies(user: LoggedInUser, db: Database, now: Now) -> list[Currency]:
    return list_owned_currencies(db, user.id, now)


@router.get("/currencies/{currency_id}/settings")
def get_settings(currency_id: OwnedCurrencyId, db: Database) -> CurrencySettings:
    row = db.execute(
        """
        SELECT api_token_hash IS NOT NULL AS has_api_token, webhook_secret_sealed IS NOT NULL AS has_webhook_secret,
            webhook_url, daily_cap
        FROM currencies WHERE id = %s
        """,
        (currency_id,),
    ).fetchone()

    return CurrencySettings.model_validate(row)


@router.patch("/currencies/{currency_id}")
def update_details(currency_id: OwnedCurrencyId, body: DetailsUpdate, db: Database, now: Now) -> Currency:
    details = checked_details(db, body.name, body.abbreviation, currency_id)
    db.execute(
        "UPDATE currencies SET name = %s, abbreviation = %s WHERE id = %s",
        (details.name, details.abbreviation, currency_id),
    )

    return find_currency_by_id(db, currency_id, now)


@router.post("/currencies/{currency_id}/api-token")
def regenerate_api_token(currency_id: OwnedCurrencyId, db: Database) -> ApiToken:
    return ApiToken(token=issue_api_token(db, currency_id))


@router.put("/currencies/{currency_id}/webhook-url", status_code=204)
def set_webhook_url(currency_id: OwnedCurrencyId, body: WebhookUrlUpdate, db: Database) -> None:
    url = checked_webhook_url(body.webhook_url)
    updated = db.execute(
        "UPDATE currencies SET webhook_url = %s WHERE id = %s AND webhook_secret_sealed IS NOT NULL RETURNING id",
        (url, currency_id),
    ).fetchone()
    if updated is None:
        raise ApiError(400, "Generate a webhook secret first, so Discoin can sign each webhook.", "webhookUrl")


@router.delete("/currencies/{currency_id}/webhook-url", status_code=204)
def remove_webhook_url(currency_id: OwnedCurrencyId, db: Database) -> None:
    db.execute("UPDATE currencies SET webhook_url = NULL WHERE id = %s", (currency_id,))


@router.put("/currencies/{currency_id}/daily-cap", status_code=204)
def set_daily_cap(currency_id: OwnedCurrencyId, body: DailyCapUpdate, db: Database) -> None:
    cap = checked_amount(body.daily_cap, "dailyCap", "daily cap")
    db.execute("UPDATE currencies SET daily_cap = %s WHERE id = %s", (cap, currency_id))


@router.delete("/currencies/{currency_id}/daily-cap", status_code=204)
def remove_daily_cap(currency_id: OwnedCurrencyId, db: Database) -> None:
    db.execute("UPDATE currencies SET daily_cap = NULL WHERE id = %s", (currency_id,))


@router.get("/currencies/{currency_id}/transactions/pending")
def get_pending_transactions(currency_id: OwnedCurrencyId, db: Database) -> list[BotTransaction]:
    return list_pending_for(db, currency_id)


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
