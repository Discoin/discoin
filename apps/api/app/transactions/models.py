from datetime import datetime
from typing import Literal
from uuid import UUID

from app.core.models import CamelModel, JsonDecimal

TransactionStatus = Literal["Pending", "Completed", "Cancelled", "Refunded", "Reversed"]


class Transaction(CamelModel):
    id: UUID
    from_currency_id: UUID
    to_currency_id: UUID
    amount: JsonDecimal
    payout: JsonDecimal
    status: TransactionStatus
    submitted_at: datetime
    handled_at: datetime | None


class BotTransaction(Transaction):
    user_id: str
