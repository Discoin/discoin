from typing import Any
from uuid import UUID

from fastapi import APIRouter
from psycopg import Connection
from psycopg.rows import DictRow

from app.auth.sessions import User, ViewingUser
from app.core.caching import PerViewerRoute
from app.core.database import Database
from app.transactions.models import (
    BotBlockCause,
    BotLabel,
    NoBlockCause,
    PrivilegedTransaction,
    SiteWideBlockCause,
    Transaction,
    TransactionCause,
)
from app.transactions.queries import CURRENCY_JOINS, PUBLIC_TRANSACTION_COLUMNS, find_transaction

UNDONE_STATUSES = ("Cancelled", "Reversed")

SITE_WIDE_BLOCK = "bl.bot_id IS NULL AND bl.currency_id IS NULL"
REASON_ALLOWED = f"""
    ({SITE_WIDE_BLOCK} AND (t.is_admin OR t.owns_a_live_bot))
    OR (s.id IS NOT NULL AND s.removed_at IS NULL AND s.owner_id = t.viewer_id)
"""
PRIVILEGED_READ = f"""
    WITH viewer AS (
        SELECT u.id, u.is_admin, EXISTS (
            SELECT 1 FROM bots b WHERE b.owner_id = u.id AND b.removed_at IS NULL
        ) AS owns_a_live_bot
        FROM users u WHERE u.id = %(viewer_id)s
    ),
    t AS (
        SELECT tx.*, v.id AS viewer_id, v.is_admin, v.owns_a_live_bot, tx.user_id = v.id AS is_trader, EXISTS (
            SELECT 1 FROM currencies c JOIN bots b ON b.id = c.bot_id
            WHERE c.id IN (tx.from_currency_id, tx.to_currency_id)
                AND c.removed_at IS NULL AND b.removed_at IS NULL AND b.owner_id = v.id
        ) AS owns_a_side
        FROM transactions tx CROSS JOIN viewer v
        WHERE tx.id = %(transaction_id)s
    )
    SELECT {PUBLIC_TRANSACTION_COLUMNS}, t.user_id, t.block_id,
        {SITE_WIDE_BLOCK} AS site_wide,
        CASE
            WHEN bl.merged_into IS NOT NULL THEN 'merged'
            WHEN bl.unblocked_at IS NOT NULL THEN 'lifted'
            ELSE 'active'
        END AS block_state,
        s.name AS bot_name, s.removed_at IS NOT NULL AS bot_removed,
        CASE WHEN {REASON_ALLOWED} THEN bl.reason END AS reason
    FROM t {CURRENCY_JOINS}
    LEFT JOIN blocks bl ON bl.id = t.block_id
    LEFT JOIN currencies bc ON bc.id = bl.currency_id
    LEFT JOIN bots s ON s.id = COALESCE(bl.bot_id, bc.bot_id)
    WHERE t.is_admin OR t.is_trader OR t.owns_a_side
"""

router = APIRouter(tags=["transactions"], route_class=PerViewerRoute)


@router.get("/transactions/{transaction_id}", response_model=None)
def get_transaction(transaction_id: UUID, viewer: ViewingUser, db: Database) -> Transaction:
    return view_transaction(db, transaction_id, viewer)


def view_transaction(db: Connection[DictRow], transaction_id: UUID, viewer: User | None) -> Transaction:
    privileged = None if viewer is None else read_privileged(db, transaction_id, viewer.id)
    if privileged is not None:
        return privileged

    return find_transaction(db, transaction_id)


def read_privileged(db: Connection[DictRow], transaction_id: UUID, viewer_id: str) -> PrivilegedTransaction | None:
    row = db.execute(PRIVILEGED_READ, {"viewer_id": viewer_id, "transaction_id": transaction_id}).fetchone()
    if row is None:
        return None

    transaction = Transaction.model_validate(row)
    cause = cause_of(row) if transaction.status in UNDONE_STATUSES else None

    return PrivilegedTransaction(**dict(transaction), user_id=row["user_id"], cause=cause)


def cause_of(row: dict[str, Any]) -> TransactionCause:
    if row["block_id"] is None:
        return NoBlockCause(kind="none")

    if row["site_wide"]:
        return SiteWideBlockCause(kind="global", state=row["block_state"], reason=row["reason"])

    if row["bot_name"] is None:
        raise RuntimeError(f"Block {row['block_id']} is on a currency with no bot, so it has no bot or site wide scope")

    bot = BotLabel(name=row["bot_name"], removed=row["bot_removed"])

    return BotBlockCause(kind="bot", bot=bot, state=row["block_state"], reason=row["reason"])
