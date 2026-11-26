from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Query
from psycopg import Connection
from psycopg.rows import DictRow

from app.core.errors import ApiError, not_found
from app.currencies.queries import require_active_currency
from app.transactions.models import BotTransaction, Transaction

DEFAULT_PAGE_SIZE = 50
LARGEST_PAGE_SIZE = 100

PUBLIC_TRANSACTION_COLUMNS = """
    t.id, t.from_currency_id, t.to_currency_id, t.amount, t.payout, t.status, t.submitted_at, t.handled_at,
    json_build_object('abbreviation', f.abbreviation, 'name', f.name, 'removed', f.removed_at IS NOT NULL)
        AS from_currency,
    json_build_object('abbreviation', o.abbreviation, 'name', o.name, 'removed', o.removed_at IS NOT NULL)
        AS to_currency
"""
TRANSACTION_COLUMNS_WITH_USER = f"t.user_id, {PUBLIC_TRANSACTION_COLUMNS}"
CURRENCY_JOINS = """
    JOIN currencies f ON f.id = t.from_currency_id
    JOIN currencies o ON o.id = t.to_currency_id
"""
UNDONE_FOR_RECEIVING_BOT = "o.bot_id = %(bot_id)s AND t.status IN ('Cancelled', 'Reversed')"
UNDONE_FOR_SENDING_BOT = "f.bot_id = %(bot_id)s AND t.status IN ('Refunded', 'Cancelled', 'Reversed')"


def returning_with_currencies(statement: str) -> str:
    return f"WITH t AS ({statement} RETURNING *) SELECT {TRANSACTION_COLUMNS_WITH_USER} FROM t {CURRENCY_JOINS}"


@dataclass(frozen=True)
class Page:
    limit: int
    before: UUID | None


def page_parameters(
    limit: Annotated[int, Query(ge=1, le=LARGEST_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    before: UUID | None = None,
) -> Page:
    return Page(limit=limit, before=before)


PageQuery = Annotated[Page, Depends(page_parameters)]


def list_recent_transactions(db: Connection[DictRow], page: Page) -> list[Transaction]:
    return fetch_page(db, "true", {}, page)


def list_currency_transactions(db: Connection[DictRow], currency_id: UUID, page: Page) -> list[Transaction]:
    require_active_currency(db, currency_id)

    return fetch_page(
        db,
        "(t.from_currency_id = %(currency_id)s OR t.to_currency_id = %(currency_id)s)",
        {"currency_id": currency_id},
        page,
    )


def list_user_transactions(db: Connection[DictRow], user_id: str, page: Page) -> list[Transaction]:
    return fetch_page(db, "t.user_id = %(user_id)s", {"user_id": user_id}, page)


def fetch_page(db: Connection[DictRow], condition: str, parameters: dict[str, Any], page: Page) -> list[Transaction]:
    require_cursor_exists(db, page.before)
    rows = db.execute(
        f"""
        SELECT {PUBLIC_TRANSACTION_COLUMNS} FROM transactions t {CURRENCY_JOINS}
        WHERE {condition}
            AND (
                %(before)s::uuid IS NULL
                OR (t.submitted_at, t.id) < (SELECT submitted_at, id FROM transactions WHERE id = %(before)s)
            )
        ORDER BY t.submitted_at DESC, t.id DESC
        LIMIT %(limit)s
        """,
        {**parameters, "before": page.before, "limit": page.limit},
    ).fetchall()

    return [Transaction.model_validate(row) for row in rows]


def find_transaction(db: Connection[DictRow], transaction_id: UUID) -> Transaction:
    row = db.execute(
        f"SELECT {PUBLIC_TRANSACTION_COLUMNS} FROM transactions t {CURRENCY_JOINS} WHERE t.id = %s", (transaction_id,)
    ).fetchone()
    if row is None:
        raise not_found("transaction")

    return Transaction.model_validate(row)


def require_cursor_exists(db: Connection[DictRow], before: UUID | None) -> None:
    if before is None:
        return

    row = db.execute("SELECT 1 FROM transactions WHERE id = %s", (before,)).fetchone()
    if row is None:
        raise ApiError(400, "No transaction with that ID to page from.", "before")


def list_pending_into_currency(db: Connection[DictRow], currency_id: UUID) -> list[BotTransaction]:
    return list_pending_where(db, "t.to_currency_id = %s", currency_id)


def list_pending_into_bot(db: Connection[DictRow], bot_id: UUID) -> list[BotTransaction]:
    return list_pending_where(db, "o.bot_id = %s", bot_id)


def list_pending_where(db: Connection[DictRow], condition: str, value: UUID) -> list[BotTransaction]:
    rows = db.execute(
        f"""
        SELECT {TRANSACTION_COLUMNS_WITH_USER} FROM transactions t {CURRENCY_JOINS}
        WHERE {condition} AND t.status = 'Pending'
        ORDER BY t.submitted_at, t.id
        """,
        (value,),
    ).fetchall()

    return [BotTransaction.model_validate(row) for row in rows]


def list_undone_for_bot(
    db: Connection[DictRow], bot_id: UUID, currency_id: UUID | None, limit: int
) -> list[BotTransaction]:
    rows = db.execute(
        f"""
        SELECT {TRANSACTION_COLUMNS_WITH_USER} FROM transactions t {CURRENCY_JOINS}
        WHERE (
                {UNDONE_FOR_RECEIVING_BOT} AND t.receiver_handled_at IS NULL
                AND (%(currency_id)s::uuid IS NULL OR t.to_currency_id = %(currency_id)s)
            ) OR (
                {UNDONE_FOR_SENDING_BOT} AND t.sender_handled_at IS NULL
                AND (%(currency_id)s::uuid IS NULL OR t.from_currency_id = %(currency_id)s)
            )
        ORDER BY t.handled_at, t.id
        LIMIT %(limit)s
        """,
        {"bot_id": bot_id, "currency_id": currency_id, "limit": limit},
    ).fetchall()

    return [BotTransaction.model_validate(row) for row in rows]


def mark_undone_handled(db: Connection[DictRow], transaction_id: UUID, bot_id: UUID, now: datetime) -> None:
    marked = db.execute(
        f"""
        UPDATE transactions t SET
            receiver_handled_at = CASE
                WHEN {UNDONE_FOR_RECEIVING_BOT} THEN coalesce(t.receiver_handled_at, %(now)s)
                ELSE t.receiver_handled_at
            END,
            sender_handled_at = CASE
                WHEN {UNDONE_FOR_SENDING_BOT} THEN coalesce(t.sender_handled_at, %(now)s)
                ELSE t.sender_handled_at
            END
        FROM currencies f, currencies o
        WHERE t.id = %(transaction_id)s AND f.id = t.from_currency_id AND o.id = t.to_currency_id
            AND (({UNDONE_FOR_RECEIVING_BOT}) OR ({UNDONE_FOR_SENDING_BOT}))
        RETURNING t.id
        """,
        {"transaction_id": transaction_id, "bot_id": bot_id, "now": now},
    ).fetchone()
    if marked is None:
        raise ApiError(400, "This transaction was not undone on your bot's side, so there is nothing to mark handled.")
