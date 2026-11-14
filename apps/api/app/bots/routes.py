from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter

from app.bots.tokens import BotCurrencyId
from app.core.database import Database, Now
from app.core.errors import ApiError, not_found
from app.core.models import CamelModel
from app.core.validation import checked_discord_id
from app.transactions.ledger import create_transaction, undo_transaction
from app.transactions.models import BotTransaction
from app.transactions.queries import list_pending_for

router = APIRouter(prefix="/transactions", tags=["bots"])

BOT_TRANSACTION_COLUMNS = """
    id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at
"""


class NewTransaction(CamelModel):
    user_id: str
    to_currency_id: UUID
    amount: Decimal


class TransactionUpdate(CamelModel):
    status: Literal["Completed", "Refunded"]


@router.post("", status_code=201)
def post_transaction(body: NewTransaction, bot: BotCurrencyId, db: Database, now: Now) -> BotTransaction:
    user_id = checked_discord_id(body.user_id, "userId")
    created = create_transaction(db, user_id, bot, body.to_currency_id, body.amount, now)

    return BotTransaction.model_validate(created)


@router.get("/pending")
def get_pending_transactions(bot: BotCurrencyId, db: Database) -> list[BotTransaction]:
    return list_pending_for(db, bot)


@router.patch("/{transaction_id}")
def patch_transaction(
    transaction_id: UUID, body: TransactionUpdate, bot: BotCurrencyId, db: Database, now: Now
) -> BotTransaction:
    transaction = lock_pending_transaction_for(db, transaction_id, bot)
    if body.status == "Refunded":
        return BotTransaction.model_validate(undo_transaction(db, transaction, "Refunded", now))

    completed = db.execute(
        f"UPDATE transactions SET status = 'Completed', handled_at = %s WHERE id = %s RETURNING {BOT_TRANSACTION_COLUMNS}",
        (now, transaction_id),
    ).fetchone()

    return BotTransaction.model_validate(completed)


def lock_pending_transaction_for(db: Database, transaction_id: UUID, bot: UUID) -> dict[str, Any]:
    transaction = db.execute(
        f"SELECT {BOT_TRANSACTION_COLUMNS} FROM transactions WHERE id = %s FOR UPDATE",
        (transaction_id,),
    ).fetchone()
    if transaction is None:
        raise not_found("transaction")

    if transaction["to_currency_id"] != bot:
        raise ApiError(403, "Only the bot receiving this transaction can update it.")

    if transaction["status"] != "Pending":
        raise ApiError(400, "Only Pending transactions can be marked Completed or Refunded.", "status")

    return transaction
