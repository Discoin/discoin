from decimal import Decimal
from typing import Any
from uuid import UUID, uuid7

from fastapi import APIRouter
from psycopg import Connection
from psycopg.rows import DictRow

from app.admin.deactivation import deactivate_currency, reactivate_currency
from app.auth.sessions import AdminUser
from app.core.database import Database, Now
from app.core.errors import ApiError, not_found
from app.core.models import CamelModel, JsonDecimal
from app.core.validation import checked_amount, checked_discord_id
from app.currencies.curve import floor2
from app.currencies.models import Currency
from app.currencies.queries import checked_details, fetch_currency_rows, find_currency_row, record_history, to_currency
from app.transactions.ledger import set_reserve

RESERVE_PER_WEEKLY_MEDIAN = 4

router = APIRouter(prefix="/admin", tags=["admins"])


class AdminCurrency(CamelModel):
    currency: Currency
    weekly_median: JsonDecimal
    owner_id: str


class NewCurrency(CamelModel):
    name: str
    abbreviation: str
    weekly_median: Decimal
    owner_id: str


class CurrencyChanges(CamelModel):
    owner_id: str | None = None
    weekly_median: Decimal | None = None
    active: bool | None = None


class Admin(CamelModel):
    user_id: str
    username: str | None


class NewAdmin(CamelModel):
    user_id: str


@router.get("/currencies")
def get_admin_currencies(admin: AdminUser, db: Database, now: Now) -> list[AdminCurrency]:
    return [to_admin_currency(row) for row in fetch_currency_rows(db, "true", {}, now)]


@router.post("/currencies", status_code=201)
def add_currency(admin: AdminUser, body: NewCurrency, db: Database, now: Now) -> AdminCurrency:
    details = checked_details(db, body.name, body.abbreviation, None)
    weekly_median = checked_weekly_median(body.weekly_median)
    owner_id = checked_discord_id(body.owner_id, "ownerId")

    currency_id = uuid7()
    reserve = starting_reserve(weekly_median)
    db.execute(
        """
        INSERT INTO currencies (id, name, abbreviation, owner_id, reserve, weekly_median)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (currency_id, details.name, details.abbreviation, owner_id, reserve, weekly_median),
    )
    record_history(db, currency_id, reserve, now)

    return to_admin_currency(find_currency_row(db, currency_id, now))


@router.patch("/currencies/{currency_id}")
def update_currency(
    currency_id: UUID, admin: AdminUser, body: CurrencyChanges, db: Database, now: Now
) -> AdminCurrency:
    if body.owner_id is None and body.weekly_median is None and body.active is None:
        raise ApiError(400, "Change the owner, the median or the status before saving.")

    owner_id = None if body.owner_id is None else checked_discord_id(body.owner_id, "ownerId")
    weekly_median = None if body.weekly_median is None else checked_weekly_median(body.weekly_median)
    was_active = lock_currency_status(db, currency_id)

    if body.active is False and was_active:
        deactivate_currency(db, currency_id, now)

    if body.active is True and not was_active:
        reactivate_currency(db, currency_id)

    if owner_id is not None:
        db.execute("UPDATE currencies SET owner_id = %s WHERE id = %s", (owner_id, currency_id))

    if weekly_median is not None:
        db.execute("UPDATE currencies SET weekly_median = %s WHERE id = %s", (weekly_median, currency_id))
        set_reserve(db, currency_id, starting_reserve(weekly_median), now)

    return to_admin_currency(find_currency_row(db, currency_id, now))


@router.get("/admins")
def get_admins(admin: AdminUser, db: Database) -> list[Admin]:
    rows = db.execute("SELECT id AS user_id, username FROM users WHERE is_admin ORDER BY created_at, id").fetchall()

    return [Admin.model_validate(row) for row in rows]


@router.post("/admins", status_code=201)
def grant_admin(admin: AdminUser, body: NewAdmin, db: Database) -> Admin:
    user_id = checked_discord_id(body.user_id, "userId")
    granted = db.execute(
        """
        INSERT INTO users (id, is_admin) VALUES (%s, true)
        ON CONFLICT (id) DO UPDATE SET is_admin = true WHERE NOT users.is_admin
        RETURNING id AS user_id, username
        """,
        (user_id,),
    ).fetchone()
    if granted is None:
        raise ApiError(409, "That user is already an admin.", "userId")

    return Admin.model_validate(granted)


@router.delete("/admins/{user_id}", status_code=204)
def remove_admin(user_id: str, admin: AdminUser, db: Database) -> None:
    if user_id == admin.id:
        raise ApiError(400, "You can't remove your own admin access. Ask another admin.")

    removed = db.execute(
        "UPDATE users SET is_admin = false WHERE id = %s AND is_admin RETURNING id", (user_id,)
    ).fetchone()
    if removed is None:
        raise ApiError(404, "No admin with that ID.")


def checked_weekly_median(weekly_median: Decimal) -> Decimal:
    return checked_amount(weekly_median, "weeklyMedian", "weekly median")


def starting_reserve(weekly_median: Decimal) -> Decimal:
    return floor2(weekly_median * RESERVE_PER_WEEKLY_MEDIAN)


def lock_currency_status(db: Connection[DictRow], currency_id: UUID) -> bool:
    row = db.execute("SELECT active FROM currencies WHERE id = %s FOR UPDATE", (currency_id,)).fetchone()
    if row is None:
        raise not_found("currency")

    return row["active"]


def to_admin_currency(row: dict[str, Any]) -> AdminCurrency:
    return AdminCurrency(currency=to_currency(row), weekly_median=row["weekly_median"], owner_id=row["owner_id"])
