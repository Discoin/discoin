from datetime import datetime
from typing import Literal
from uuid import UUID

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
