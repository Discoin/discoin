from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.core.models import CamelModel, JsonDecimal

TransactionStatus = Literal["Pending", "Completed", "Cancelled", "Refunded", "Reversed"]


class TransactionRecord(CamelModel):
    id: UUID
    from_currency_id: UUID
    to_currency_id: UUID
    amount: JsonDecimal
    payout: JsonDecimal
    status: TransactionStatus
    submitted_at: datetime
    handled_at: datetime | None


class WebhookTransaction(TransactionRecord):
    user_id: str


class CurrencyLabel(CamelModel):
    abbreviation: str
    name: str
    removed: bool


class Transaction(TransactionRecord):
    from_currency: CurrencyLabel
    to_currency: CurrencyLabel


class BotTransaction(Transaction):
    user_id: str


BlockState = Literal["active", "lifted", "merged"]


def is_absent(value: object) -> bool:
    return value is None


class NoBlockCause(CamelModel):
    kind: Literal["none"]


class SiteWideBlockCause(CamelModel):
    kind: Literal["global"]
    state: BlockState
    reason: str | None = Field(default=None, exclude_if=is_absent)


class BotLabel(CamelModel):
    name: str
    removed: bool


class BotBlockCause(CamelModel):
    kind: Literal["bot"]
    bot: BotLabel
    state: BlockState
    reason: str | None = Field(default=None, exclude_if=is_absent)


TransactionCause = NoBlockCause | SiteWideBlockCause | BotBlockCause


class PrivilegedTransaction(Transaction):
    user_id: str
    cause: TransactionCause | None = Field(default=None, exclude_if=is_absent)
