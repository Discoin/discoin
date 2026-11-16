from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.auth.sessions import LoggedInUser
from app.core.database import Database
from app.core.errors import ApiError, not_found

CURRENCY_ID_FIELD = "currencyId"


@dataclass(frozen=True)
class BotOwnership:
    bot_id: UUID
    owner_id: str

    @property
    def subject(self) -> str:
        return "bot"


@dataclass(frozen=True)
class Ownership(BotOwnership):
    currency_id: UUID

    @property
    def subject(self) -> str:
        return "currency"


def not_yours(owned: BotOwnership) -> ApiError:
    return ApiError(403, f"You don't own that {owned.subject}.")


def owned_currency(currency_id: UUID, user: LoggedInUser, db: Database) -> Ownership:
    return require_owner(db, currency_id, user.id)


OwnedCurrency = Annotated[Ownership, Depends(owned_currency)]


def owned_currency_locked(owned: OwnedCurrency, db: Database) -> Ownership:
    lock_owned_bot(db, owned)
    lock_live_currency(db, owned.currency_id)

    return owned


OwnedCurrencyForWrite = Annotated[Ownership, Depends(owned_currency_locked)]


def owned_bot(bot_id: UUID, user: LoggedInUser, db: Database) -> BotOwnership:
    owned = BotOwnership(bot_id=bot_id, owner_id=user.id)
    bot = db.execute("SELECT owner_id FROM bots WHERE id = %s AND removed_at IS NULL", (bot_id,)).fetchone()
    if bot is None:
        raise not_found(owned.subject)

    if bot["owner_id"] != owned.owner_id:
        raise not_yours(owned)

    return owned


OwnedBot = Annotated[BotOwnership, Depends(owned_bot)]


def owned_bot_locked(owned: OwnedBot, db: Database) -> BotOwnership:
    lock_owned_bot(db, owned)

    return owned


OwnedBotForWrite = Annotated[BotOwnership, Depends(owned_bot_locked)]


def require_owner(db: Database, currency_id: UUID, user_id: str) -> Ownership:
    row = db.execute(
        """
        SELECT c.bot_id, b.owner_id FROM currencies c LEFT JOIN bots b ON b.id = c.bot_id
        WHERE c.id = %s AND c.removed_at IS NULL
        """,
        (currency_id,),
    ).fetchone()
    if row is None:
        raise not_found("currency")

    if row["bot_id"] is None:
        raise ApiError(403, "This currency has no bot yet, so nobody owns it. Ask a Discoin admin to assign its bot.")

    owned = Ownership(currency_id=currency_id, bot_id=row["bot_id"], owner_id=user_id)
    if row["owner_id"] != user_id:
        raise not_yours(owned)

    return owned


def lock_live_currency(db: Database, currency_id: UUID) -> None:
    currency = db.execute(
        "SELECT abbreviation, active, removed_at IS NOT NULL AS removed FROM currencies WHERE id = %s FOR NO KEY UPDATE",
        (currency_id,),
    ).fetchone()
    if currency["removed"]:
        raise not_found("currency")

    if not currency["active"]:
        raise ApiError(
            400,
            f"{currency['abbreviation']} is inactive, so its settings can't be changed until a Discoin admin "
            "reactivates it.",
            CURRENCY_ID_FIELD,
        )


def lock_owned_bot(db: Database, owned: BotOwnership) -> None:
    bot = db.execute(
        "SELECT owner_id, removed_at IS NOT NULL AS removed FROM bots WHERE id = %s FOR NO KEY UPDATE", (owned.bot_id,)
    ).fetchone()
    if bot["removed"]:
        raise not_found(owned.subject)

    if bot["owner_id"] != owned.owner_id:
        raise not_yours(owned)
