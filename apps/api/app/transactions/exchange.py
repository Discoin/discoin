from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.core.errors import ApiError
from app.core.validation import checked_amount
from app.currencies.curve import CurveSide, payout


@dataclass(frozen=True)
class ExchangeSide:
    id: UUID
    abbreviation: str
    active: bool
    removed: bool
    curve: CurveSide


EXCHANGE_SIDE_COLUMNS = "id, abbreviation, active, removed_at IS NOT NULL AS removed, reserve, worth"


def load_exchange_side(db: Connection[DictRow], currency_id: UUID, field: str) -> ExchangeSide:
    row = db.execute(f"SELECT {EXCHANGE_SIDE_COLUMNS} FROM currencies WHERE id = %s", (currency_id,)).fetchone()
    if row is None:
        raise unknown_currency(field)

    return to_exchange_side(row)


def lock_exchange_sides(db: Connection[DictRow], currency_ids: set[UUID]) -> dict[UUID, ExchangeSide]:
    rows = db.execute(
        f"SELECT {EXCHANGE_SIDE_COLUMNS} FROM currencies WHERE id = ANY(%s) ORDER BY id FOR NO KEY UPDATE",
        (list(currency_ids),),
    ).fetchall()

    return {row["id"]: to_exchange_side(row) for row in rows}


def to_exchange_side(row: dict[str, Any]) -> ExchangeSide:
    return ExchangeSide(
        id=row["id"],
        abbreviation=row["abbreviation"],
        active=row["active"],
        removed=row["removed"],
        curve=CurveSide(reserve=row["reserve"], worth=row["worth"]),
    )


def unknown_currency(field: str) -> ApiError:
    return ApiError(404, "No currency with that ID.", field)


def checked_payout(amount: Decimal, source: ExchangeSide, target: ExchangeSide) -> Decimal:
    checked_amount(amount, "amount", "amount")

    if source.id == target.id:
        raise ApiError(400, "Pick a different currency to convert into.", "toCurrencyId")

    for side, field in ((source, "fromCurrencyId"), (target, "toCurrencyId")):
        require_tradeable(side, field)

    result = payout(amount, source.curve, target.curve)
    if result == 0:
        raise ApiError(400, "This amount is too small to convert. Send more.", "amount")

    return result


def require_tradeable(side: ExchangeSide, field: str) -> None:
    if side.removed:
        raise unknown_currency(field)

    if not side.active:
        raise ApiError(400, f"{side.abbreviation} is inactive, so it can't be converted right now.", field)
