from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow

from app.bots.feed import lock_feeds_receiving
from app.transactions.ledger import undo_transaction
from app.transactions.locking import LockPlan, lock_currencies_first
from app.webhooks.delivery import enqueue_webhook


def deactivate_currency(db: Connection[DictRow], currency_id: UUID, now: datetime) -> None:
    cancel_pending(db, frozenset({currency_id}), now)
    db.execute("UPDATE currencies SET active = false WHERE id = %s", (currency_id,))


def reactivate_currency(db: Connection[DictRow], currency_id: UUID) -> None:
    db.execute("UPDATE currencies SET active = true WHERE id = %s", (currency_id,))


def cancel_pending(db: Connection[DictRow], currency_ids: frozenset[UUID], now: datetime) -> None:
    plan = LockPlan(currency_ids, lambda lock: find_pending(db, currency_ids, lock))
    pending = lock_currencies_first(db, plan)
    lock_feeds_receiving(db, [transaction["to_currency_id"] for transaction in pending])

    for transaction in pending:
        cancelled = undo_transaction(db, transaction, "Cancelled", now)
        enqueue_webhook(db, cancelled, "cancelled", now)


def find_pending(db: Connection[DictRow], currency_ids: frozenset[UUID], lock: sql.Composable) -> list[dict[str, Any]]:
    query = sql.SQL(
        """
        SELECT t.id, t.user_id, t.from_currency_id, t.to_currency_id, t.amount, t.payout, t.status,
            t.submitted_at, t.handled_at
        FROM transactions t
        WHERE t.status = 'Pending' AND (t.from_currency_id = ANY(%(ids)s) OR t.to_currency_id = ANY(%(ids)s))
        ORDER BY t.submitted_at DESC, t.id DESC
        {lock}
        """
    ).format(lock=lock)

    return db.execute(query, {"ids": list(currency_ids)}).fetchall()
