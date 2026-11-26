from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.database import Database, Now
from app.currencies.models import Currency, Quote, ReservePoint
from app.currencies.queries import (
    find_currency_by_abbreviation,
    list_active_currencies,
    reserve_history,
)
from app.transactions.exchange import checked_payout, load_exchange_side

router = APIRouter(tags=["currencies"])


@router.get("/currencies")
def get_currencies(db: Database, now: Now) -> list[Currency]:
    return list_active_currencies(db, now)


@router.get("/currencies/{abbreviation}")
def get_currency(abbreviation: str, db: Database, now: Now) -> Currency:
    return find_currency_by_abbreviation(db, abbreviation, now)


@router.get("/currencies/{currency_id}/history")
def get_reserve_history(currency_id: UUID, days: int, db: Database, now: Now) -> list[ReservePoint]:
    return reserve_history(db, currency_id, days, now)


@router.get("/quote")
def get_quote(
    from_currency_id: Annotated[UUID, Query(alias="fromCurrencyId")],
    to_currency_id: Annotated[UUID, Query(alias="toCurrencyId")],
    amount: Decimal,
    db: Database,
) -> Quote:
    source = load_exchange_side(db, from_currency_id, "fromCurrencyId")
    target = load_exchange_side(db, to_currency_id, "toCurrencyId")

    return Quote(payout=checked_payout(amount, source, target))
