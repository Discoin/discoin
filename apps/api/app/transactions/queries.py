from dataclasses import dataclass
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Query
from psycopg import Connection
from psycopg.rows import DictRow

from app.core.errors import ApiError
from app.currencies.queries import require_currency_exists
from app.transactions.models import BotTransaction, Transaction

DEFAULT_PAGE_SIZE = 50
LARGEST_PAGE_SIZE = 100

TRANSACTION_COLUMNS = """
    id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at
"""


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
    require_currency_exists(db, currency_id)

    return fetch_page(
        db,
        "(from_currency_id = %(currency_id)s OR to_currency_id = %(currency_id)s)",
        {"currency_id": currency_id},
        page,
    )


def list_user_transactions(db: Connection[DictRow], user_id: str, page: Page) -> list[Transaction]:
    return fetch_page(db, "user_id = %(user_id)s", {"user_id": user_id}, page)


def fetch_page(db: Connection[DictRow], condition: str, parameters: dict[str, Any], page: Page) -> list[Transaction]:
    require_cursor_exists(db, page.before)
    rows = db.execute(
        f"""
        SELECT {TRANSACTION_COLUMNS} FROM transactions
        WHERE {condition}
            AND (
                %(before)s::uuid IS NULL
                OR (submitted_at, id) < (SELECT submitted_at, id FROM transactions WHERE id = %(before)s)
            )
        ORDER BY submitted_at DESC, id DESC
        LIMIT %(limit)s
        """,
        {**parameters, "before": page.before, "limit": page.limit},
    ).fetchall()

    return [Transaction.model_validate(row) for row in rows]


def require_cursor_exists(db: Connection[DictRow], before: UUID | None) -> None:
    if before is None:
        return

    row = db.execute("SELECT 1 FROM transactions WHERE id = %s", (before,)).fetchone()
    if row is None:
        raise ApiError(400, "No transaction with that ID to page from.", "before")


def list_pending_for(db: Connection[DictRow], currency_id: UUID) -> list[BotTransaction]:
    rows = db.execute(
        f"""
        SELECT user_id, {TRANSACTION_COLUMNS} FROM transactions
        WHERE to_currency_id = %s AND status = 'Pending'
        ORDER BY submitted_at, id
        """,
        (currency_id,),
    ).fetchall()

    return [BotTransaction.model_validate(row) for row in rows]
