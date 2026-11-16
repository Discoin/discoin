from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid7

from psycopg import Connection
from psycopg.rows import DictRow

from app.core.errors import ApiError
from app.currencies.curve import give_back, max_amount
from app.currencies.queries import record_history
from app.transactions.exchange import ExchangeSide, checked_payout, lock_exchange_sides, unknown_currency
from app.transactions.queries import returning_with_currencies
from app.webhooks.delivery import enqueue_webhook

DAILY_CAP_WINDOW = timedelta(hours=24)
COUNTED_TOWARD_CAP = ("Pending", "Completed")


def create_transaction(
    db: Connection[DictRow], user_id: str, source_id: UUID, target_id: UUID, amount: Decimal, now: datetime
) -> dict[str, Any]:
    sides = lock_exchange_sides(db, {source_id, target_id})
    if target_id not in sides:
        raise unknown_currency("toCurrencyId")

    source, target = sides[source_id], sides[target_id]
    paid_out = checked_payout(amount, source, target)
    require_not_blocked(db, user_id, source, target)
    require_within_daily_cap(db, user_id, source, target, paid_out, now)

    set_reserve(db, source.id, source.curve.reserve + amount, now)
    set_reserve(db, target.id, target.curve.reserve - paid_out, now)

    created = db.execute(
        returning_with_currencies(
            """
            INSERT INTO transactions (id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at)
            VALUES (%s, %s, %s, %s, %s, %s, 'Pending', %s)
            """
        ),
        (uuid7(), user_id, source.id, target.id, amount, paid_out, now),
    ).fetchone()
    enqueue_webhook(db, created, "created", now)

    return created


def undo_transaction(
    db: Connection[DictRow], transaction: dict[str, Any], status: str, now: datetime, block_id: int | None = None
) -> dict[str, Any]:
    sides = lock_exchange_sides(db, {transaction["from_currency_id"], transaction["to_currency_id"]})
    source = sides[transaction["from_currency_id"]]
    target = sides[transaction["to_currency_id"]]
    returned = give_back(transaction["payout"], source.curve, target.curve)

    set_reserve(db, target.id, target.curve.reserve + transaction["payout"], now)
    set_reserve(db, source.id, source.curve.reserve - returned, now)

    return db.execute(
        returning_with_currencies("UPDATE transactions SET status = %s, handled_at = %s, block_id = %s WHERE id = %s"),
        (status, now, block_id, transaction["id"]),
    ).fetchone()


def set_reserve(db: Connection[DictRow], currency_id: UUID, reserve: Decimal, now: datetime) -> None:
    db.execute("UPDATE currencies SET reserve = %s WHERE id = %s", (reserve, currency_id))
    record_history(db, currency_id, reserve, now)


def require_not_blocked(db: Connection[DictRow], user_id: str, source: ExchangeSide, target: ExchangeSide) -> None:
    row = db.execute(
        """
        SELECT 1 FROM blocks
        WHERE user_id = %(user_id)s AND unblocked_at IS NULL AND (
            (currency_id IS NULL AND bot_id IS NULL)
            OR currency_id = ANY(%(currency_ids)s)
            OR bot_id IN (SELECT bot_id FROM currencies WHERE id = ANY(%(currency_ids)s))
        )
        LIMIT 1
        """,
        {"user_id": user_id, "currency_ids": [source.id, target.id]},
    ).fetchone()
    if row is not None:
        raise ApiError(403, "This user is blocked from converting these currencies.", "userId")


def require_within_daily_cap(
    db: Connection[DictRow],
    user_id: str,
    source: ExchangeSide,
    target: ExchangeSide,
    paid_out: Decimal,
    now: datetime,
) -> None:
    row = db.execute(
        """
        SELECT c.daily_cap, c.daily_cap - coalesce(sum(t.payout), 0) AS remaining
        FROM currencies c
        LEFT JOIN transactions t ON t.to_currency_id = c.id AND t.user_id = %(user_id)s
            AND t.status = ANY(%(counted)s) AND t.submitted_at > %(since)s
        WHERE c.id = %(target_id)s
        GROUP BY c.id
        """,
        {
            "user_id": user_id,
            "counted": list(COUNTED_TOWARD_CAP),
            "since": now - DAILY_CAP_WINDOW,
            "target_id": target.id,
        },
    ).fetchone()
    if row["daily_cap"] is None or paid_out <= row["remaining"]:
        return

    most = max_amount(row["remaining"], source.curve, target.curve)
    raise ApiError(
        400,
        f"This would take the user past {target.abbreviation}'s daily cap. "
        f"They can send at most {most} {source.abbreviation} right now.",
        "amount",
        maxAmount=float(most),
    )
