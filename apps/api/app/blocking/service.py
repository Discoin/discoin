from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow

from app.core.errors import ApiError
from app.core.models import CamelModel
from app.core.validation import checked_discord_id, checked_text
from app.transactions.exchange import lock_exchange_sides
from app.transactions.ledger import undo_transaction
from app.transactions.models import Transaction
from app.webhooks.delivery import ADMINS, Trigger, enqueue_webhook, owner_of

ReverseWindow = Literal["24h", "7d", "30d", "all"]
ReverseDirection = Literal["incoming", "outgoing", "both"]

WINDOW_LENGTHS: dict[str, timedelta | None] = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "all": None,
}

DIRECTION_FILTERS = {
    "incoming": sql.SQL("to_currency_id = %(currency_id)s"),
    "outgoing": sql.SQL("from_currency_id = %(currency_id)s"),
    "both": sql.SQL("(to_currency_id = %(currency_id)s OR from_currency_id = %(currency_id)s)"),
}
EVERY_TRANSACTION = sql.SQL("true")

TRANSACTION_COLUMNS = sql.SQL(
    "id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at"
)


class ReverseRequest(CamelModel):
    window: ReverseWindow
    direction: ReverseDirection | None = None


class BlockRequest(CamelModel):
    user_id: str
    reason: str
    reverse: ReverseRequest | None = None


class PreviewRequest(CamelModel):
    user_id: str
    reason: str
    reverse: ReverseRequest


class BlockedUser(CamelModel):
    user_id: str
    reason: str
    blocked_at: datetime
    level: Literal["currency", "global"]


class BlockResult(CamelModel):
    blocked: BlockedUser
    reversed: list[Transaction]


@dataclass(frozen=True)
class BlockScope:
    currency_id: UUID | None

    @property
    def level(self) -> Literal["currency", "global"]:
        return "global" if self.currency_id is None else "currency"

    @property
    def trigger(self) -> Trigger:
        return ADMINS if self.currency_id is None else owner_of(self.currency_id)

    def checked_reverse(self, reverse: ReverseRequest) -> ReverseRequest:
        if self.currency_id is None and reverse.direction is not None:
            raise ApiError(400, "An admin block reverses every direction, so it takes no direction.", "direction")

        if self.currency_id is not None and reverse.direction is None:
            raise ApiError(400, "Pick which direction to reverse.", "direction")

        return reverse

    def reversal_filter(self, reverse: ReverseRequest) -> sql.Composable:
        if reverse.direction is None:
            return EVERY_TRANSACTION

        return DIRECTION_FILTERS[reverse.direction]

    def cancellation_filter(self) -> sql.Composable:
        if self.currency_id is None:
            return EVERY_TRANSACTION

        return DIRECTION_FILTERS["both"]


GLOBAL = BlockScope(currency_id=None)


@dataclass(frozen=True)
class BlockTarget:
    user_id: str
    reason: str


def currency_scope(currency_id: UUID) -> BlockScope:
    return BlockScope(currency_id=currency_id)


def list_blocks(db: Connection[DictRow], scope: BlockScope) -> list[BlockedUser]:
    rows = db.execute(
        """
        SELECT user_id, reason, blocked_at, CASE WHEN currency_id IS NULL THEN 'global' ELSE 'currency' END AS level
        FROM blocks
        WHERE unblocked_at IS NULL AND (currency_id IS NULL OR currency_id = %s)
        ORDER BY blocked_at DESC, id DESC
        """,
        (scope.currency_id,),
    ).fetchall()

    return [BlockedUser.model_validate(row) for row in rows]


def preview_block(
    db: Connection[DictRow], scope: BlockScope, request: PreviewRequest, now: datetime
) -> list[Transaction]:
    target = checked_block_target(db, scope, request.user_id, request.reason)
    rows = find_reversible(db, scope, target.user_id, scope.checked_reverse(request.reverse), now)

    return [Transaction.model_validate(row) for row in rows]


def block_user(
    db: Connection[DictRow], scope: BlockScope, request: BlockRequest, blocker_id: str, now: datetime
) -> BlockResult:
    target = checked_block_target(db, scope, request.user_id, request.reason)
    to_reverse = find_requested_reversals(db, scope, target.user_id, request.reverse, now)
    to_cancel = find_cancellable(db, scope, target.user_id)
    lock_exchange_sides(db, involved_currencies(to_reverse + to_cancel))
    block = db.execute(
        """
        INSERT INTO blocks (user_id, currency_id, reason, blocked_by, blocked_at) VALUES (%s, %s, %s, %s, %s)
        RETURNING id, user_id, reason, blocked_at
        """,
        (target.user_id, scope.currency_id, target.reason, blocker_id, now),
    ).fetchone()

    undone = undo_all(db, scope, block["id"], to_reverse, to_cancel, now)
    reversed_ids = {row["id"] for row in to_reverse}
    blocked = BlockedUser(
        user_id=block["user_id"], reason=block["reason"], blocked_at=block["blocked_at"], level=scope.level
    )

    return BlockResult(
        blocked=blocked,
        reversed=[Transaction.model_validate(row) for row in undone if row["id"] in reversed_ids],
    )


def unblock_user(db: Connection[DictRow], scope: BlockScope, user_id: str, unblocker_id: str, now: datetime) -> None:
    unblocked = db.execute(
        """
        UPDATE blocks SET unblocked_by = %s, unblocked_at = %s
        WHERE user_id = %s AND currency_id IS NOT DISTINCT FROM %s AND unblocked_at IS NULL
        RETURNING id
        """,
        (unblocker_id, now, user_id, scope.currency_id),
    ).fetchone()
    if unblocked is not None:
        return

    if scope.currency_id is not None and has_global_block(db, user_id):
        raise ApiError(403, "Only Discoin admins can remove this block.")

    raise ApiError(404, "No blocked user with that ID.")


def checked_block_target(db: Connection[DictRow], scope: BlockScope, user_id: str, reason: str) -> BlockTarget:
    checked_id = checked_discord_id(user_id, "userId")
    checked_reason = checked_text(reason, "reason", "reason")

    if scope.currency_id is not None and has_global_block(db, checked_id):
        raise ApiError(400, "Already blocked by Discoin admins.", "userId")

    existing = db.execute(
        """
        SELECT 1 FROM blocks
        WHERE user_id = %s AND currency_id IS NOT DISTINCT FROM %s AND unblocked_at IS NULL
        """,
        (checked_id, scope.currency_id),
    ).fetchone()
    if existing is not None:
        raise ApiError(409, "That user is already blocked.", "userId")

    return BlockTarget(user_id=checked_id, reason=checked_reason)


def has_global_block(db: Connection[DictRow], user_id: str) -> bool:
    row = db.execute(
        "SELECT 1 FROM blocks WHERE user_id = %s AND currency_id IS NULL AND unblocked_at IS NULL", (user_id,)
    ).fetchone()

    return row is not None


def find_requested_reversals(
    db: Connection[DictRow], scope: BlockScope, user_id: str, reverse: ReverseRequest | None, now: datetime
) -> list[dict[str, Any]]:
    if reverse is None:
        return []

    return find_reversible(db, scope, user_id, scope.checked_reverse(reverse), now)


def find_reversible(
    db: Connection[DictRow], scope: BlockScope, user_id: str, reverse: ReverseRequest, now: datetime
) -> list[dict[str, Any]]:
    window = WINDOW_LENGTHS[reverse.window]
    since = None if window is None else now - window

    return find_transactions(db, scope, user_id, "Completed", scope.reversal_filter(reverse), since)


def find_cancellable(db: Connection[DictRow], scope: BlockScope, user_id: str) -> list[dict[str, Any]]:
    return find_transactions(db, scope, user_id, "Pending", scope.cancellation_filter(), None)


def find_transactions(
    db: Connection[DictRow],
    scope: BlockScope,
    user_id: str,
    status: str,
    involves: sql.Composable,
    since: datetime | None,
) -> list[dict[str, Any]]:
    query = sql.SQL(
        """
        SELECT {columns} FROM transactions
        WHERE user_id = %(user_id)s AND status = %(status)s AND {involves}
            AND (%(since)s::timestamptz IS NULL OR submitted_at >= %(since)s)
        ORDER BY submitted_at DESC, id DESC
        FOR UPDATE
        """
    ).format(columns=TRANSACTION_COLUMNS, involves=involves)

    return db.execute(
        query,
        {"user_id": user_id, "status": status, "since": since, "currency_id": scope.currency_id},
    ).fetchall()


def involved_currencies(transactions: list[dict[str, Any]]) -> set[UUID]:
    return {row["from_currency_id"] for row in transactions} | {row["to_currency_id"] for row in transactions}


def undo_all(
    db: Connection[DictRow],
    scope: BlockScope,
    block_id: int,
    to_reverse: list[dict[str, Any]],
    to_cancel: list[dict[str, Any]],
    now: datetime,
) -> list[dict[str, Any]]:
    plan = [(row, "Reversed", "reversed") for row in to_reverse] + [
        (row, "Cancelled", "cancelled") for row in to_cancel
    ]
    plan.sort(key=lambda step: (step[0]["submitted_at"], step[0]["id"]), reverse=True)
    undone = []

    for row, status, event in plan:
        updated = undo_transaction(db, row, status, now, block_id)
        enqueue_webhook(db, updated, event, now, scope.trigger)
        undone.append(updated)

    return undone
