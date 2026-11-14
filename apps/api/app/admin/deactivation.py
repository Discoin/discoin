from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.transactions.exchange import lock_exchange_sides
from app.transactions.ledger import undo_transaction
from app.webhooks.delivery import enqueue_webhook


def deactivate_currency(db: Connection[DictRow], currency_id: UUID, now: datetime) -> None:
    pending = lock_pending_transactions(db, currency_id)
    lock_exchange_sides(db, {row["from_currency_id"] for row in pending} | {row["to_currency_id"] for row in pending})

    for transaction in pending:
        cancelled = undo_transaction(db, transaction, "Cancelled", now)
        enqueue_webhook(db, cancelled, "cancelled", now)

    db.execute("UPDATE currencies SET active = false WHERE id = %s", (currency_id,))


def reactivate_currency(db: Connection[DictRow], currency_id: UUID) -> None:
    db.execute("UPDATE currencies SET active = true WHERE id = %s", (currency_id,))


def lock_pending_transactions(db: Connection[DictRow], currency_id: UUID) -> list[dict[str, Any]]:
    return db.execute(
        """
        SELECT id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at
        FROM transactions
        WHERE status = 'Pending' AND (from_currency_id = %(id)s OR to_currency_id = %(id)s)
        ORDER BY submitted_at DESC, id DESC
        FOR UPDATE
        """,
        {"id": currency_id},
    ).fetchall()
