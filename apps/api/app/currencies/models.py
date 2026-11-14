from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.core.models import CamelModel, JsonDecimal


class Currency(CamelModel):
    id: UUID
    abbreviation: str
    name: str
    reserve: JsonDecimal
    active: bool
    change24h: JsonDecimal = Field(alias="change24h")
    value_history: list[JsonDecimal]


class ReservePoint(CamelModel):
    at: datetime
    reserve: JsonDecimal


class Quote(CamelModel):
    payout: JsonDecimal
