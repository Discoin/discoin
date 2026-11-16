import re
from decimal import Decimal

from pydantic import BaseModel

from app.core.errors import ApiError

MAX_AMOUNT = Decimal(1_000_000_000)
CENT_EXPONENT = -2
DISCORD_ID_PATTERN = re.compile(r"^[0-9]{17,20}$")


def checked_amount(amount: Decimal, field: str, label: str) -> Decimal:
    checked_positive_cents(amount, field, label)

    if amount > MAX_AMOUNT:
        raise ApiError(400, f"The {label} can be at most {MAX_AMOUNT:,}.", field)

    return amount


def checked_positive_cents(amount: Decimal, field: str, label: str) -> Decimal:
    if not amount.is_finite() or amount <= 0:
        raise ApiError(400, f"The {label} must be above 0.", field)

    if amount.as_tuple().exponent < CENT_EXPONENT:
        raise ApiError(400, f"The {label} can have at most 2 decimals.", field)

    return amount


def checked_discord_id(value: str, field: str) -> str:
    trimmed = value.strip()
    if not DISCORD_ID_PATTERN.match(trimmed):
        raise ApiError(400, "Enter a Discord user ID: 17 to 20 digits, like 412358906715234305.", field)

    return trimmed


def require_sent_values(body: BaseModel, fields: dict[str, tuple[str, str]]) -> None:
    for name, (field, label) in fields.items():
        if name in body.model_fields_set and getattr(body, name) is None:
            raise ApiError(400, f"Enter the {label}.", field)


def checked_text(value: str, field: str, label: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ApiError(400, f"Enter a {label}.", field)

    return trimmed
