from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid7

from fastapi import APIRouter
from psycopg import Connection
from psycopg.rows import DictRow

from app.admin import bots
from app.admin.deactivation import deactivate_currency, reactivate_currency
from app.admin.removal import RemovalPreview, preview_currency_removal, remove_currency
from app.auth.sessions import AdminUser
from app.blocking.service import BotAssignment, move_blocks_to_bot
from app.core.database import Database, Now
from app.core.errors import ApiError, not_found
from app.core.models import CamelModel, JsonDecimal
from app.core.validation import checked_amount, checked_discord_id, checked_positive_cents, require_sent_values
from app.currencies.curve import floor2
from app.currencies.models import Currency
from app.currencies.queries import (
    checked_details,
    claiming_abbreviation,
    fetch_currency_rows,
    find_currency_row,
    record_history,
    to_currency,
)
from app.transactions.ledger import set_reserve

MAX_RESERVE = Decimal("99999999999999.99")
RESERVE_FIELDS = {
    "weekly_median": ("weeklyMedian", "weekly median"),
    "multiplier": ("multiplier", "reserve multiplier"),
}
PICK_A_BOT = "Pick the bot that runs this currency."

router = APIRouter(prefix="/admin", tags=["admins"])
router.include_router(bots.router)


class BotName(CamelModel):
    id: UUID
    name: str


class AdminCurrency(CamelModel):
    currency: Currency
    weekly_median: JsonDecimal
    multiplier: JsonDecimal
    bot: BotName | None


class SavedCurrency(CamelModel):
    saved: AdminCurrency
    moved_blocks: int


class NewCurrency(CamelModel):
    name: str
    abbreviation: str
    weekly_median: Decimal
    multiplier: Decimal
    bot_id: UUID | None = None


class CurrencyChanges(CamelModel):
    bot_id: UUID | None = None
    weekly_median: Decimal | None = None
    multiplier: Decimal | None = None
    active: bool | None = None


@dataclass(frozen=True)
class ReserveTerms:
    weekly_median: Decimal
    multiplier: Decimal
    blamed_field: str

    def __post_init__(self) -> None:
        if self.weekly_median * self.multiplier > MAX_RESERVE:
            raise ApiError(
                400,
                f"This median and multiplier give a reserve above {MAX_RESERVE:,}. Lower one of them.",
                self.blamed_field,
            )

        if self.starting_reserve <= 0:
            raise ApiError(
                400, "This median and multiplier give a reserve below 0.01. Raise one of them.", self.blamed_field
            )

    @property
    def starting_reserve(self) -> Decimal:
        return floor2(self.weekly_median * self.multiplier)


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
    terms = ReserveTerms(checked_weekly_median(body.weekly_median), checked_multiplier(body.multiplier), "multiplier")
    bot_id = checked_bot(db, body.bot_id)

    currency_id = uuid7()
    reserve = terms.starting_reserve
    with claiming_abbreviation(details.abbreviation):
        db.execute(
            """
            INSERT INTO currencies (id, name, abbreviation, bot_id, reserve, weekly_median, multiplier)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (currency_id, details.name, details.abbreviation, bot_id, reserve, terms.weekly_median, terms.multiplier),
        )
    record_history(db, currency_id, reserve, now)

    return to_admin_currency(find_currency_row(db, currency_id, now))


@router.patch("/currencies/{currency_id}")
def update_currency(
    currency_id: UUID, admin: AdminUser, body: CurrencyChanges, db: Database, now: Now
) -> SavedCurrency:
    require_sent_values(body, RESERVE_FIELDS)

    if not asks_for_a_change(body):
        raise ApiError(400, "Pick a bot, change the median, the multiplier or the status before saving.")

    requested_bot = lock_requested_bot(db, body)

    if body.active is False:
        # Deactivation locks this currency together with its counterparties, so it must come before lock_currency.
        deactivate_currency(db, currency_id, now)

    stored = lock_currency(db, currency_id)
    require_assignable(body, stored)
    terms = changed_reserve_terms(body, stored)

    if body.active is True and not stored["active"]:
        reactivate_currency(db, currency_id)

    moved_blocks = (
        0 if requested_bot is None else assign_bot(db, BotAssignment(currency_id, requested_bot, admin.id, now))
    )

    if terms is not None:
        db.execute(
            "UPDATE currencies SET weekly_median = %s, multiplier = %s WHERE id = %s",
            (terms.weekly_median, terms.multiplier, currency_id),
        )
        set_reserve(db, currency_id, terms.starting_reserve, now)

    return SavedCurrency(saved=to_admin_currency(find_currency_row(db, currency_id, now)), moved_blocks=moved_blocks)


@router.get("/currencies/{currency_id}/removal")
def get_currency_removal(currency_id: UUID, admin: AdminUser, db: Database) -> RemovalPreview:
    return preview_currency_removal(db, currency_id)


@router.delete("/currencies/{currency_id}", status_code=204)
def delete_currency(currency_id: UUID, admin: AdminUser, db: Database, now: Now) -> None:
    remove_currency(db, currency_id, now)


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


def checked_multiplier(multiplier: Decimal) -> Decimal:
    return checked_positive_cents(multiplier, "multiplier", "reserve multiplier")


def changed_reserve_terms(body: CurrencyChanges, stored: dict[str, Any]) -> ReserveTerms | None:
    if body.weekly_median is None and body.multiplier is None:
        return None

    weekly_median = stored["weekly_median"] if body.weekly_median is None else checked_weekly_median(body.weekly_median)
    multiplier = stored["multiplier"] if body.multiplier is None else checked_multiplier(body.multiplier)
    blamed_field = "weeklyMedian" if body.multiplier is None else "multiplier"

    return ReserveTerms(weekly_median, multiplier, blamed_field)


def asks_for_a_change(body: CurrencyChanges) -> bool:
    values = (body.weekly_median, body.multiplier, body.active)

    return "bot_id" in body.model_fields_set or any(value is not None for value in values)


def checked_bot(db: Connection[DictRow], bot_id: UUID | None) -> UUID:
    if bot_id is None:
        raise ApiError(400, PICK_A_BOT, "botId")

    row = db.execute("SELECT id FROM bots WHERE id = %s AND removed_at IS NULL FOR NO KEY UPDATE", (bot_id,)).fetchone()
    if row is None:
        raise ApiError(404, "No bot with that ID.", "botId")

    return row["id"]


def lock_requested_bot(db: Connection[DictRow], body: CurrencyChanges) -> UUID | None:
    if "bot_id" not in body.model_fields_set or body.bot_id is None:
        return None

    return checked_bot(db, body.bot_id)


def require_assignable(body: CurrencyChanges, stored: DictRow) -> None:
    if "bot_id" not in body.model_fields_set:
        return

    if stored["bot_id"] is not None:
        raise ApiError(409, "This currency already has a bot. Currencies can't change bot.", "botId")

    if body.bot_id is None:
        raise ApiError(400, PICK_A_BOT, "botId")


def assign_bot(db: Connection[DictRow], assignment: BotAssignment) -> int:
    db.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (assignment.bot_id, assignment.currency_id))

    return move_blocks_to_bot(db, assignment)


def lock_currency(db: Connection[DictRow], currency_id: UUID) -> DictRow:
    row = db.execute(
        """
        SELECT active, weekly_median, multiplier, bot_id FROM currencies
        WHERE id = %s AND removed_at IS NULL
        FOR NO KEY UPDATE
        """,
        (currency_id,),
    ).fetchone()
    if row is None:
        raise not_found("currency")

    return row


def to_admin_currency(row: dict[str, Any]) -> AdminCurrency:
    bot = None if row["bot_id"] is None else BotName(id=row["bot_id"], name=row["bot_name"])

    return AdminCurrency(
        currency=to_currency(row),
        weekly_median=row["weekly_median"],
        multiplier=row["multiplier"],
        bot=bot,
    )
