from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow

from app.core.errors import ApiError
from app.core.models import CamelModel
from app.core.validation import checked_discord_id, checked_text
from app.owners.access import BotOwnership
from app.transactions.ledger import undo_transaction
from app.transactions.locking import UNLOCKED, LockPlan, TransactionFinder, lock_currencies_first
from app.transactions.models import Transaction
from app.transactions.queries import CURRENCY_JOINS, TRANSACTION_COLUMNS
from app.webhooks.delivery import ADMINS, Trigger, enqueue_webhook, owner_of

ReverseWindow = Literal["24h", "7d", "30d", "all"]
ReverseDirection = Literal["incoming", "outgoing", "both"]
BlockLevel = Literal["bot", "global"]

WINDOW_LENGTHS: dict[str, timedelta | None] = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "all": None,
}

DIRECTION_FILTERS = {
    "incoming": sql.SQL("o.bot_id = %(bot_id)s"),
    "outgoing": sql.SQL("f.bot_id = %(bot_id)s"),
    "both": sql.SQL("(o.bot_id = %(bot_id)s OR f.bot_id = %(bot_id)s)"),
}
EVERY_TRANSACTION = sql.SQL("true")
UNDO_STEPS = {"Completed": ("Reversed", "reversed"), "Pending": ("Cancelled", "cancelled")}


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
    level: BlockLevel


class BlockResult(CamelModel):
    blocked: BlockedUser
    reversed: list[Transaction]


@dataclass(frozen=True)
class TransactionSearch:
    bot_id: UUID | None
    user_id: str
    status: str
    involves: sql.Composable
    since: datetime | None

    def run(self, db: Connection[DictRow], lock: sql.Composable) -> list[dict[str, Any]]:
        query = sql.SQL(
            """
            SELECT {columns} FROM transactions t {joins}
            WHERE t.user_id = %(user_id)s AND t.status = %(status)s AND {involves}
                AND f.removed_at IS NULL AND o.removed_at IS NULL
                AND (%(since)s::timestamptz IS NULL OR t.submitted_at >= %(since)s)
            ORDER BY t.submitted_at DESC, t.id DESC
            {lock}
            """
        ).format(columns=sql.SQL(TRANSACTION_COLUMNS), joins=sql.SQL(CURRENCY_JOINS), involves=self.involves, lock=lock)

        return db.execute(
            query, {"user_id": self.user_id, "status": self.status, "since": self.since, "bot_id": self.bot_id}
        ).fetchall()


@dataclass(frozen=True)
class BlockScope:
    bot_id: UUID | None

    @property
    def is_global(self) -> bool:
        return self.bot_id is None

    @property
    def level(self) -> BlockLevel:
        return "global" if self.is_global else "bot"

    @property
    def trigger(self) -> Trigger:
        return ADMINS if self.bot_id is None else owner_of(self.bot_id)

    def undo_searches(self, user_id: str, reverse: ReverseRequest | None, now: datetime) -> list[TransactionSearch]:
        cancellation = TransactionSearch(self.bot_id, user_id, "Pending", self.cancellation_filter(), None)

        if reverse is None:
            return [cancellation]

        return [self.reversal_search(user_id, self.checked_reverse(reverse), now), cancellation]

    def reversal_search(self, user_id: str, reverse: ReverseRequest, now: datetime) -> TransactionSearch:
        window = WINDOW_LENGTHS[reverse.window]
        since = None if window is None else now - window

        return TransactionSearch(self.bot_id, user_id, "Completed", self.reversal_filter(reverse), since)

    def checked_reverse(self, reverse: ReverseRequest) -> ReverseRequest:
        if self.is_global and reverse.direction is not None:
            raise ApiError(400, "An admin block reverses every direction, so it takes no direction.", "direction")

        if not self.is_global and reverse.direction is None:
            raise ApiError(400, "Pick which direction to reverse.", "direction")

        return reverse

    def reversal_filter(self, reverse: ReverseRequest) -> sql.Composable:
        if reverse.direction is None:
            return EVERY_TRANSACTION

        return DIRECTION_FILTERS[reverse.direction]

    def cancellation_filter(self) -> sql.Composable:
        if self.is_global:
            return EVERY_TRANSACTION

        return DIRECTION_FILTERS["both"]


GLOBAL = BlockScope(bot_id=None)


@dataclass(frozen=True)
class BlockTarget:
    user_id: str
    reason: str


@dataclass(frozen=True)
class BotAssignment:
    currency_id: UUID
    bot_id: UUID
    admin_id: str
    at: datetime


def owner_scope(owned: BotOwnership) -> BlockScope:
    return BlockScope(bot_id=owned.bot_id)


def move_blocks_to_bot(db: Connection[DictRow], assignment: BotAssignment) -> int:
    moving = db.execute(
        "SELECT id, user_id, blocked_at FROM blocks WHERE currency_id = %s AND unblocked_at IS NULL ORDER BY id FOR UPDATE",
        (assignment.currency_id,),
    ).fetchall()

    for block in moving:
        move_block(db, block, assignment)

    return len(moving)


def move_block(db: Connection[DictRow], block: dict[str, Any], assignment: BotAssignment) -> None:
    existing = db.execute(
        "SELECT id, blocked_at FROM blocks WHERE user_id = %s AND bot_id = %s AND unblocked_at IS NULL FOR UPDATE",
        (block["user_id"], assignment.bot_id),
    ).fetchone()
    if existing is not None and blocked_first(existing, block):
        merge_block(db, block["id"], existing["id"], assignment)
        return

    if existing is not None:
        merge_block(db, existing["id"], block["id"], assignment)

    db.execute("UPDATE blocks SET currency_id = NULL, bot_id = %s WHERE id = %s", (assignment.bot_id, block["id"]))


def blocked_first(block: dict[str, Any], other: dict[str, Any]) -> bool:
    return (block["blocked_at"], block["id"]) < (other["blocked_at"], other["id"])


def merge_block(db: Connection[DictRow], closed_id: int, kept_id: int, assignment: BotAssignment) -> None:
    db.execute(
        "UPDATE blocks SET unblocked_by = %s, unblocked_at = %s, merged_into = %s WHERE id = %s",
        (assignment.admin_id, assignment.at, kept_id, closed_id),
    )


def list_blocks(db: Connection[DictRow], scope: BlockScope) -> list[BlockedUser]:
    rows = db.execute(
        """
        SELECT user_id, reason, blocked_at, CASE WHEN bot_id IS NULL THEN 'global' ELSE 'bot' END AS level
        FROM blocks
        WHERE unblocked_at IS NULL AND currency_id IS NULL AND (bot_id IS NULL OR bot_id = %s)
        ORDER BY blocked_at DESC, id DESC
        """,
        (scope.bot_id,),
    ).fetchall()

    return [BlockedUser.model_validate(row) for row in rows]


def preview_block(
    db: Connection[DictRow], scope: BlockScope, request: PreviewRequest, now: datetime
) -> list[Transaction]:
    target = checked_block_target(db, scope, request.user_id, request.reason)
    search = scope.reversal_search(target.user_id, scope.checked_reverse(request.reverse), now)

    return [Transaction.model_validate(row) for row in search.run(db, UNLOCKED)]


def block_user(
    db: Connection[DictRow], scope: BlockScope, request: BlockRequest, blocker_id: str, now: datetime
) -> BlockResult:
    target = checked_block_target(db, scope, request.user_id, request.reason)
    searches = scope.undo_searches(target.user_id, request.reverse, now)
    to_undo = lock_currencies_first(db, LockPlan(currencies_run_by(db, scope), finder_of(db, searches)))
    block = db.execute(
        """
        INSERT INTO blocks (user_id, bot_id, reason, blocked_by, blocked_at) VALUES (%s, %s, %s, %s, %s)
        RETURNING id, user_id, reason, blocked_at
        """,
        (target.user_id, scope.bot_id, target.reason, blocker_id, now),
    ).fetchone()

    undone = undo_all(db, scope, block["id"], to_undo, now)
    blocked = BlockedUser(
        user_id=block["user_id"], reason=block["reason"], blocked_at=block["blocked_at"], level=scope.level
    )

    return BlockResult(
        blocked=blocked,
        reversed=[Transaction.model_validate(row) for row in undone if row["status"] == "Reversed"],
    )


def unblock_user(db: Connection[DictRow], scope: BlockScope, user_id: str, unblocker_id: str, now: datetime) -> None:
    unblocked = db.execute(
        """
        UPDATE blocks SET unblocked_by = %s, unblocked_at = %s
        WHERE user_id = %s AND currency_id IS NULL AND bot_id IS NOT DISTINCT FROM %s AND unblocked_at IS NULL
        RETURNING id
        """,
        (unblocker_id, now, user_id, scope.bot_id),
    ).fetchone()
    if unblocked is not None:
        return

    if not scope.is_global and has_global_block(db, user_id):
        raise ApiError(403, "Only Discoin admins can remove this block.")

    raise ApiError(404, "No blocked user with that ID.")


def checked_block_target(db: Connection[DictRow], scope: BlockScope, user_id: str, reason: str) -> BlockTarget:
    checked_id = checked_discord_id(user_id, "userId")
    checked_reason = checked_text(reason, "reason", "reason")

    if not scope.is_global and has_global_block(db, checked_id):
        raise ApiError(400, "Already blocked by Discoin admins.", "userId")

    existing = db.execute(
        """
        SELECT 1 FROM blocks
        WHERE user_id = %s AND currency_id IS NULL AND bot_id IS NOT DISTINCT FROM %s AND unblocked_at IS NULL
        """,
        (checked_id, scope.bot_id),
    ).fetchone()
    if existing is not None:
        raise ApiError(409, "That user is already blocked.", "userId")

    return BlockTarget(user_id=checked_id, reason=checked_reason)


def has_global_block(db: Connection[DictRow], user_id: str) -> bool:
    row = db.execute(
        """
        SELECT 1 FROM blocks
        WHERE user_id = %s AND currency_id IS NULL AND bot_id IS NULL AND unblocked_at IS NULL
        """,
        (user_id,),
    ).fetchone()

    return row is not None


def currencies_run_by(db: Connection[DictRow], scope: BlockScope) -> frozenset[UUID]:
    if scope.is_global:
        return frozenset()

    rows = db.execute("SELECT id FROM currencies WHERE bot_id = %s AND removed_at IS NULL", (scope.bot_id,)).fetchall()

    return frozenset(row["id"] for row in rows)


def finder_of(db: Connection[DictRow], searches: list[TransactionSearch]) -> TransactionFinder:
    return lambda lock: [row for search in searches for row in search.run(db, lock)]


def undo_all(
    db: Connection[DictRow], scope: BlockScope, block_id: int, to_undo: list[dict[str, Any]], now: datetime
) -> list[dict[str, Any]]:
    newest_first = sorted(to_undo, key=lambda row: (row["submitted_at"], row["id"]), reverse=True)
    undone = []

    for row in newest_first:
        status, event = UNDO_STEPS[row["status"]]
        updated = undo_transaction(db, row, status, now, block_id)
        enqueue_webhook(db, updated, event, now, scope.trigger)
        undone.append(updated)

    return undone
