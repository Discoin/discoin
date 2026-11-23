from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.admin.deactivation import cancel_pending
from app.bots.feed import clear_feed
from app.core.errors import not_found
from app.core.models import CamelModel
from app.transactions.exchange import lock_exchange_sides
from app.webhooks.delivery import drop_pending_deliveries

BOT_REMOVED = "The bot was removed."


@dataclass(frozen=True)
class LiveRow:
    query: str
    what: str

    def locked(self) -> LiveRow:
        return LiveRow(f"{self.query} FOR NO KEY UPDATE", self.what)


LIVE_CURRENCY = LiveRow(
    "SELECT id, abbreviation, name FROM currencies WHERE id = %s AND removed_at IS NULL", "currency"
)
LIVE_BOT = LiveRow("SELECT id FROM bots WHERE id = %s AND removed_at IS NULL", "bot")


class CurrencyName(CamelModel):
    id: UUID
    abbreviation: str
    name: str


class RemovalPreview(CamelModel):
    currencies: list[CurrencyName]
    pending_transactions: int
    enforced_blocks: int


def preview_currency_removal(db: Connection[DictRow], currency_id: UUID) -> RemovalPreview:
    currency = fetch_live(db, LIVE_CURRENCY, currency_id)
    blocks = count_active_blocks(db, "currency_id = %s", currency_id)

    return removal_preview(db, [currency], blocks)


def preview_bot_removal(db: Connection[DictRow], bot_id: UUID) -> RemovalPreview:
    fetch_live(db, LIVE_BOT, bot_id)
    blocks = count_active_blocks(db, "bot_id = %s", bot_id)

    return removal_preview(db, bot_currencies(db, bot_id), blocks)


def remove_currency(db: Connection[DictRow], currency_id: UUID, now: datetime) -> None:
    currency_ids = frozenset({currency_id})
    cancel_pending(db, currency_ids, now)
    fetch_live(db, LIVE_CURRENCY, currency_id)
    retire_currencies(db, currency_ids, now)


def remove_bot(db: Connection[DictRow], bot_id: UUID, now: datetime) -> None:
    fetch_live(db, LIVE_BOT.locked(), bot_id)
    disconnect_webhook(db, bot_id)
    currency_ids = live_currency_ids(db, bot_id)
    cancel_pending(db, currency_ids, now)
    retire_currencies(db, currency_ids, now)
    drop_pending_deliveries(db, bot_id, BOT_REMOVED)
    clear_feed(db, bot_id)
    # Clearing the unique token column blocks foreign key checks on this bot row, so it runs after every other lock.
    db.execute("UPDATE bots SET api_token_hash = NULL, removed_at = %s WHERE id = %s", (now, bot_id))


def revoke_credentials(db: Connection[DictRow], bot_id: UUID, reason: str) -> None:
    # Holding the bot's currencies makes every trade that could queue one of its webhooks finish before the drop.
    lock_exchange_sides(db, set(live_currency_ids(db, bot_id)))
    db.execute(
        "UPDATE bots SET api_token_hash = NULL, webhook_url = NULL, webhook_secret_sealed = NULL WHERE id = %s",
        (bot_id,),
    )
    drop_pending_deliveries(db, bot_id, reason)
    clear_feed(db, bot_id)


def disconnect_webhook(db: Connection[DictRow], bot_id: UUID) -> None:
    db.execute("UPDATE bots SET webhook_url = NULL, webhook_secret_sealed = NULL WHERE id = %s", (bot_id,))


def live_currency_ids(db: Connection[DictRow], bot_id: UUID) -> frozenset[UUID]:
    return frozenset(currency["id"] for currency in bot_currencies(db, bot_id))


def retire_currencies(db: Connection[DictRow], currency_ids: frozenset[UUID], now: datetime) -> None:
    db.execute("UPDATE currencies SET active = false, removed_at = %s WHERE id = ANY(%s)", (now, list(currency_ids)))


def fetch_live(db: Connection[DictRow], live: LiveRow, row_id: UUID) -> DictRow:
    row = db.execute(live.query, (row_id,)).fetchone()
    if row is None:
        raise not_found(live.what)

    return row


def bot_currencies(db: Connection[DictRow], bot_id: UUID) -> list[DictRow]:
    return db.execute(
        "SELECT id, abbreviation, name FROM currencies WHERE bot_id = %s AND removed_at IS NULL ORDER BY abbreviation",
        (bot_id,),
    ).fetchall()


def count_active_blocks(db: Connection[DictRow], scope: str, scope_id: UUID) -> int:
    row = db.execute(
        f"SELECT count(*) AS blocks FROM blocks WHERE unblocked_at IS NULL AND {scope}", (scope_id,)
    ).fetchone()

    return row["blocks"]


def removal_preview(db: Connection[DictRow], currencies: list[DictRow], enforced_blocks: int) -> RemovalPreview:
    currency_ids = [currency["id"] for currency in currencies]
    pending = db.execute(
        """
        SELECT count(*) AS pending FROM transactions
        WHERE status = 'Pending' AND (from_currency_id = ANY(%(ids)s) OR to_currency_id = ANY(%(ids)s))
        """,
        {"ids": currency_ids},
    ).fetchone()

    return RemovalPreview(
        currencies=[CurrencyName.model_validate(currency) for currency in currencies],
        pending_transactions=pending["pending"],
        enforced_blocks=enforced_blocks,
    )
