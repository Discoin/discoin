from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.core.models import CamelModel

DESCRIPTION = (
    "Discoin converts between Discord bot currencies along a bonding curve. "
    "These are the endpoints for bots: public market data, and transactions for your bot's currencies. "
    "Transaction endpoints need `Authorization: Bearer <token>`, with the API token from the bot owner page. "
    "Tokens issued before bots existed no longer work, so generate a new one on the bot owner page. "
    "The token identifies your bot, not a currency, so name your own currency on every call, even when your bot "
    "runs only one: `fromCurrencyId` to create a transaction, and `currencyId` to list pending ones. "
    "A currency that doesn't exist or was removed answers 404, and one your bot doesn't run answers 403. "
    "Your bot can settle any transaction into one of its currencies. "
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
