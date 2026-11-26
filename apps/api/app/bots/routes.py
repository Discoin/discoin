from dataclasses import dataclass
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query
from psycopg import Connection
from psycopg.rows import DictRow

from app.bots.tokens import CallingBotId
from app.core.database import Database, Now
from app.core.errors import ApiError, not_found
from app.core.models import CamelModel
from app.core.validation import checked_discord_id
from app.transactions.exchange import lock_exchange_sides, unknown_currency
from app.transactions.ledger import create_transaction, undo_transaction
from app.transactions.models import BotTransaction
from app.transactions.queries import (
    CURRENCY_JOINS,
    DEFAULT_PAGE_SIZE,
    LARGEST_PAGE_SIZE,
    list_pending_into_bot,
    list_pending_into_currency,
    list_undone_for_bot,
    mark_undone_handled,
    returning_with_currencies,
)

router = APIRouter(prefix="/transactions", tags=["bots"])

BOT_TRANSACTION_COLUMNS = """
    id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at
"""


class NewTransaction(CamelModel):
    user_id: str
    from_currency_id: UUID
    to_currency_id: UUID
    amount: Decimal


class TransactionUpdate(CamelModel):
    status: Literal["Completed", "Refunded"]


@dataclass(frozen=True)
class BotCurrency:
    bot_id: UUID
    currency_id: UUID
    field: str


@router.post("", status_code=201)
def post_transaction(body: NewTransaction, bot: CallingBotId, db: Database, now: Now) -> BotTransaction:
    user_id = checked_discord_id(body.user_id, "userId")
    source = require_bot_currency(db, BotCurrency(bot, body.from_currency_id, "fromCurrencyId"))
    created = create_transaction(db, user_id, source, body.to_currency_id, body.amount, now)

    return BotTransaction.model_validate(created)


@router.get("/pending")
def get_pending_transactions(
    bot: CallingBotId, db: Database, currency_id: Annotated[UUID | None, Query(alias="currencyId")] = None
) -> list[BotTransaction]:
    if currency_id is None:
        return list_pending_into_bot(db, bot)

    return list_pending_into_currency(db, require_bot_currency(db, BotCurrency(bot, currency_id, "currencyId")))


@router.get("/undone")
def get_undone_transactions(
    bot: CallingBotId,
    db: Database,
    currency_id: Annotated[UUID | None, Query(alias="currencyId")] = None,
    limit: Annotated[int, Query(ge=1, le=LARGEST_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> list[BotTransaction]:
    if currency_id is not None:
        require_bot_currency(db, BotCurrency(bot, currency_id, "currencyId"))

    return list_undone_for_bot(db, bot, currency_id, limit)


@router.put("/{transaction_id}/handled", status_code=204)
def put_transaction_handled(transaction_id: UUID, bot: CallingBotId, db: Database, now: Now) -> None:
    require_a_side_run_by(db, transaction_id, bot)
    mark_undone_handled(db, transaction_id, bot, now)


@router.patch("/{transaction_id}")
def patch_transaction(
    transaction_id: UUID, body: TransactionUpdate, bot: CallingBotId, db: Database, now: Now
) -> BotTransaction:
    transaction = lock_pending(db, require_received_by(db, transaction_id, bot))

    if body.status == "Refunded":
        return BotTransaction.model_validate(undo_transaction(db, transaction, "Refunded", now))

    completed = db.execute(
        returning_with_currencies("UPDATE transactions SET status = 'Completed', handled_at = %s WHERE id = %s"),
        (now, transaction_id),
    ).fetchone()

    return BotTransaction.model_validate(completed)


def require_bot_currency(db: Connection[DictRow], claim: BotCurrency) -> UUID:
    currency = db.execute(
        "SELECT bot_id FROM currencies WHERE id = %s AND removed_at IS NULL", (claim.currency_id,)
    ).fetchone()
    if currency is None:
        raise unknown_currency(claim.field)

    if currency["bot_id"] != claim.bot_id:
        raise ApiError(403, "That currency isn't run by this bot. Send one of your own currencies.", claim.field)

    return claim.currency_id


def require_received_by(db: Connection[DictRow], transaction_id: UUID, bot_id: UUID) -> dict[str, Any]:
    transaction = db.execute(
        """
        SELECT t.id, t.from_currency_id, t.to_currency_id, c.bot_id AS receiving_bot_id
        FROM transactions t JOIN currencies c ON c.id = t.to_currency_id
        WHERE t.id = %s
        """,
        (transaction_id,),
    ).fetchone()
    if transaction is None:
        raise not_found("transaction")

    if transaction["receiving_bot_id"] != bot_id:
        raise ApiError(403, "Only the bot receiving this transaction can update it.")

    return transaction


def require_a_side_run_by(db: Connection[DictRow], transaction_id: UUID, bot_id: UUID) -> None:
    transaction = db.execute(
        f"""
        SELECT f.bot_id AS sending_bot_id, o.bot_id AS receiving_bot_id
        FROM transactions t {CURRENCY_JOINS}
        WHERE t.id = %s
        """,
        (transaction_id,),
    ).fetchone()
    if transaction is None:
        raise not_found("transaction")

    if bot_id not in (transaction["sending_bot_id"], transaction["receiving_bot_id"]):
        raise ApiError(403, "Only the bots sending or receiving this transaction can mark it handled.")


def lock_pending(db: Connection[DictRow], transaction: dict[str, Any]) -> dict[str, Any]:
    lock_exchange_sides(db, {transaction["from_currency_id"], transaction["to_currency_id"]})
    locked = db.execute(
        f"SELECT {BOT_TRANSACTION_COLUMNS} FROM transactions WHERE id = %s FOR UPDATE", (transaction["id"],)
    ).fetchone()
    if locked["status"] != "Pending":
        raise ApiError(400, "Only Pending transactions can be marked Completed or Refunded.", "status")

    return locked
