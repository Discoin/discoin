from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.core.models import CamelModel

DESCRIPTION = (
    "Discoin converts between Discord bot currencies along a bonding curve. "
    "These are the endpoints for bots: public market data, and transactions for your bot's currencies. "
    "Transaction endpoints need `Authorization: Bearer <token>`, with the API token from the bot owner page. "
    "Tokens issued before bots existed no longer work, so generate a new one on the bot owner page. "
    "The token identifies your bot, not a currency, so name your own `fromCurrencyId` to create a transaction, "
    "even when your bot runs only one. Pending transactions list all of your currencies, or only the one in "
    "`currencyId`. "
    "A currency that doesn't exist or was removed answers 404, and one your bot doesn't run answers 403. "
    "Your bot can settle any transaction into one of its currencies. "
    "A bot with no webhook URL takes its events with `POST /events/claim` and reports each one with "
    "`POST /events/{id}/result` and `{handled: true}` or `{handled: false}`. A claim leases its events for "
    "2 minutes. An unhandled event, or one never reported before its lease ran out, comes back after a backoff "
    "that starts at 1 minute and doubles, without holding back later events. After 8 tries an event is dead and is "
    "not returned again, and every event is deleted after 24 hours. Each claimed event carries `attempt`, its try "
    "number. Handlers must be idempotent by transaction ID, and should check that the transaction is still Pending "
    "when `attempt` is above 1. "
    "Every webhook and event feed body carries a `test` boolean, false on real events. "
    "The Test button on the bot owner page sends a `transaction.created` event with `test: true` and a made up "
    "transaction, so check `test` before paying out. Mark a test with `PATCH /transactions/{id}` like a real "
    "transaction: no coins move, and a test is unknown 10 minutes after it was sent. "
    "Errors always return `{status, message, field}`, with `field` naming the input at fault or null."
)
VALIDATION_SCHEMAS = ("HTTPValidationError", "ValidationError")


class ErrorBody(CamelModel):
    status: int
    message: str
    field: str | None


def install_openapi(app: FastAPI) -> None:
    def build_schema() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = cleaned_schema(app)

        return app.openapi_schema

    app.openapi = build_schema


def cleaned_schema(app: FastAPI) -> dict[str, Any]:
    schema = get_openapi(title=app.title, version=app.version, description=DESCRIPTION, routes=app.routes)
    schemas = schema.setdefault("components", {}).setdefault("schemas", {})
    schemas["ErrorBody"] = ErrorBody.model_json_schema(by_alias=True)
    error_reference = {"$ref": "#/components/schemas/ErrorBody"}

    for name in VALIDATION_SCHEMAS:
        schemas.pop(name, None)

    for operations in schema["paths"].values():
        for operation in operations.values():
            describe_errors(operation, error_reference)

    return schema


def describe_errors(operation: dict[str, Any], error_reference: dict[str, str]) -> None:
    responses = operation["responses"]
    responses.pop("422", None)
    responses["default"] = {
        "description": "Error",
        "content": {"application/json": {"schema": error_reference}},
    }
