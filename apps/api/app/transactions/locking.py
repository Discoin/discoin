from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg import Connection, Rollback, sql
from psycopg.rows import DictRow

from app.transactions.exchange import lock_exchange_sides

UNLOCKED = sql.SQL("")
LOCKED = sql.SQL("FOR UPDATE OF t")

TransactionFinder = Callable[[sql.Composable], list[dict[str, Any]]]


@dataclass(frozen=True)
class LockPlan:
    currency_ids: frozenset[UUID]
    find: TransactionFinder


def lock_currencies_first(db: Connection[DictRow], plan: LockPlan) -> list[dict[str, Any]]:
    wanted = plan.currency_ids | involved_currencies(plan.find(UNLOCKED))
    with db.transaction() as savepoint:
        lock_exchange_sides(db, set(wanted))
        locked = plan.find(LOCKED)
        if involved_currencies(locked) <= wanted:
            return locked

        # Rolling back the savepoint frees these currency locks, so the retry takes the larger set in id order.
        raise Rollback(savepoint)

    return lock_currencies_first(db, plan)


def involved_currencies(transactions: list[dict[str, Any]]) -> set[UUID]:
    return {row["from_currency_id"] for row in transactions} | {row["to_currency_id"] for row in transactions}
