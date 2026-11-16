import re
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.core.database import unique_as_field_error
from app.core.errors import ApiError, not_found
from app.core.validation import checked_text
from app.currencies.curve import CurveSide, value
from app.currencies.models import Currency, ReservePoint

SPARKLINE_DAYS = 7
HISTORY_DAYS = (7, 30)

CURRENCY_QUERY = """
    SELECT
        c.id, c.abbreviation, c.name, c.reserve, c.worth, c.active, c.weekly_median, c.multiplier, c.bot_id,
        b.name AS bot_name,
        (
            SELECT h.value FROM currency_history h
            WHERE h.currency_id = c.id AND h.recorded_at <= %(day_ago)s
            ORDER BY h.recorded_at DESC, h.id DESC LIMIT 1
        ) AS value_day_ago,
        (
            SELECT h.value FROM currency_history h
            WHERE h.currency_id = c.id
            ORDER BY h.recorded_at, h.id LIMIT 1
        ) AS first_value,
        ARRAY(
            SELECT (
                SELECT h.value FROM currency_history h
                WHERE h.currency_id = c.id AND h.recorded_at <= point
                ORDER BY h.recorded_at DESC, h.id DESC LIMIT 1
            )
            FROM generate_series(%(sparkline_start)s::timestamptz, %(now)s::timestamptz, interval '1 day') AS point
        ) AS value_history
    FROM currencies c
    LEFT JOIN bots b ON b.id = c.bot_id
"""


def list_active_currencies(db: Connection[DictRow], now: datetime) -> list[Currency]:
    return [to_currency(row) for row in fetch_currency_rows(db, "c.active", {}, now)]


def list_all_currencies(db: Connection[DictRow], now: datetime) -> list[Currency]:
    return [to_currency(row) for row in fetch_currency_rows(db, "true", {}, now)]


def list_owned_currency_rows(db: Connection[DictRow], owner_id: str, now: datetime) -> list[dict[str, Any]]:
    return fetch_currency_rows(db, "b.owner_id = %(owner_id)s", {"owner_id": owner_id}, now)


def find_currency_by_abbreviation(db: Connection[DictRow], abbreviation: str, now: datetime) -> Currency:
    wanted = abbreviation.upper()
    rows = fetch_currency_rows(db, "c.abbreviation = %(abbreviation)s", {"abbreviation": wanted}, now)
    if not rows:
        raise ApiError(404, f"No currency called {wanted}.")

    return to_currency(rows[0])


def find_currency_by_id(db: Connection[DictRow], currency_id: UUID, now: datetime) -> Currency:
    return to_currency(find_currency_row(db, currency_id, now))


def find_currency_row(db: Connection[DictRow], currency_id: UUID, now: datetime) -> dict[str, Any]:
    rows = fetch_currency_rows(db, "c.id = %(currency_id)s", {"currency_id": currency_id}, now)
    if not rows:
        raise not_found("currency")

    return rows[0]


def fetch_currency_rows(
    db: Connection[DictRow], condition: str, parameters: dict[str, Any], now: datetime
) -> list[dict[str, Any]]:
    return db.execute(
        f"{CURRENCY_QUERY} WHERE c.removed_at IS NULL AND ({condition}) ORDER BY c.abbreviation",
        {**currency_query_times(now), **parameters},
    ).fetchall()


def currency_query_times(now: datetime) -> dict[str, datetime]:
    return {
        "now": now,
        "day_ago": now - timedelta(days=1),
        "sparkline_start": now - timedelta(days=SPARKLINE_DAYS),
    }


def to_currency(row: dict[str, Any]) -> Currency:
    current_value = value(CurveSide(reserve=row["reserve"], worth=row["worth"]))
    baseline = row["value_day_ago"] if row["value_day_ago"] is not None else row["first_value"]
    sparkline = [point for point in row["value_history"] if point is not None]

    return Currency(
        id=row["id"],
        abbreviation=row["abbreviation"],
        name=row["name"],
        reserve=row["reserve"],
        active=row["active"],
        change24h=current_value / baseline - 1,
        value_history=sparkline,
    )


def reserve_history(db: Connection[DictRow], currency_id: UUID, days: int, now: datetime) -> list[ReservePoint]:
    if days not in HISTORY_DAYS:
        raise ApiError(400, "Pick a history of 7 or 30 days.", "days")

    require_currency_exists(db, currency_id)
    start = now - timedelta(days=days)
    rows = db.execute(
        """
        (
            SELECT %(start)s::timestamptz AS at, reserve FROM currency_history
            WHERE currency_id = %(currency_id)s AND recorded_at < %(start)s
            ORDER BY recorded_at DESC, id DESC LIMIT 1
        )
        UNION ALL
        (
            SELECT recorded_at AS at, reserve FROM currency_history
            WHERE currency_id = %(currency_id)s AND recorded_at >= %(start)s AND recorded_at <= %(now)s
            ORDER BY recorded_at, id
        )
        """,
        {"currency_id": currency_id, "start": start, "now": now},
    ).fetchall()

    return [ReservePoint(at=row["at"], reserve=row["reserve"]) for row in rows]


def require_currency_exists(db: Connection[DictRow], currency_id: UUID) -> None:
    row = db.execute("SELECT 1 FROM currencies WHERE id = %s AND removed_at IS NULL", (currency_id,)).fetchone()
    if row is None:
        raise not_found("currency")


def record_history(db: Connection[DictRow], currency_id: UUID, reserve: Decimal, at: datetime) -> None:
    db.execute(
        """
        INSERT INTO currency_history (currency_id, reserve, value, recorded_at)
        SELECT id, %(reserve)s, worth / %(reserve)s, %(at)s FROM currencies
        WHERE id = %(currency_id)s AND removed_at IS NULL
        """,
        {"currency_id": currency_id, "reserve": reserve, "at": at},
    )


ABBREVIATION_PATTERN = re.compile(r"^[A-Z]{3,4}$")
ABBREVIATION_INDEX = "currencies_abbreviation"


@dataclass(frozen=True)
class CurrencyDetails:
    name: str
    abbreviation: str


def checked_details(
    db: Connection[DictRow], name: str, abbreviation: str, excluding_id: UUID | None
) -> CurrencyDetails:
    checked_name = checked_text(name, "name", "name")
    checked_abbreviation = checked_text(abbreviation, "abbreviation", "abbreviation").upper()
    if not ABBREVIATION_PATTERN.fullmatch(checked_abbreviation):
        raise ApiError(400, "Use 3 or 4 letters, A to Z, for the abbreviation.", "abbreviation")

    if abbreviation_in_use(db, checked_abbreviation, excluding_id):
        raise abbreviation_taken(checked_abbreviation)

    return CurrencyDetails(name=checked_name, abbreviation=checked_abbreviation)


def abbreviation_in_use(db: Connection[DictRow], abbreviation: str, excluding_id: UUID | None) -> bool:
    row = db.execute(
        "SELECT 1 FROM currencies WHERE abbreviation = %s AND id IS DISTINCT FROM %s AND removed_at IS NULL",
        (abbreviation, excluding_id),
    ).fetchone()

    return row is not None


def claiming_abbreviation(abbreviation: str) -> AbstractContextManager[None]:
    return unique_as_field_error(ABBREVIATION_INDEX, abbreviation_taken(abbreviation))


def abbreviation_taken(abbreviation: str) -> ApiError:
    return ApiError(409, f"{abbreviation} is taken by another currency. Pick a different abbreviation.", "abbreviation")
