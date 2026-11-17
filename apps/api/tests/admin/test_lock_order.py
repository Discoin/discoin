import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app.admin.bots import BotChanges, update_bot
from app.admin.deactivation import deactivate_currency
from app.admin.removal import remove_bot, remove_currency
from app.admin.routes import CurrencyChanges, SavedCurrency, update_currency
from app.auth.sessions import User
from app.blocking.service import BlockRequest, BlockResult, ReverseRequest, block_user, owner_scope
from app.bots.routes import TransactionUpdate, patch_transaction
from app.bots.tokens import issue_api_token
from app.core.errors import ApiError
from app.owners.access import BotOwnership, lock_owned_bot, require_owner
from app.owners.routes import resend_webhook
from app.transactions.exchange import lock_exchange_sides
from app.transactions.ledger import create_transaction
from tests.factories import (
    ADMIN_ID,
    LOCK_TIMEOUT_MS,
    NOW,
    OWNER_ID,
    USER_ID,
    bot_of,
    create_botless_currency,
    create_currency,
    status_of,
)
from tests.webhooks.receiver import connect_webhook

POLL_SECONDS = 0.02
WAIT_LIMIT_SECONDS = 5
ADMIN = User(id=ADMIN_ID, username=None, avatar_hash=None, is_admin=True)

CurrencyRetirement = Callable[[psycopg.Connection, UUID, datetime], None]
BotRevocation = Callable[[psycopg.Connection, UUID], None]


def wait_until_blocked_on_a_lock(observer: psycopg.Connection, pid: int) -> None:
    deadline = time.monotonic() + WAIT_LIMIT_SECONDS
    while time.monotonic() < deadline:
        row = observer.execute("SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s", (pid,)).fetchone()
        if row["wait_event_type"] == "Lock":
            return

        time.sleep(POLL_SECONDS)

    raise AssertionError(f"Backend {pid} never waited for a lock")


def test_assigning_a_bot_waits_for_an_owner_block_instead_of_deadlocking(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    bot_id = bot_of(connection, oats)
    pebbles = create_botless_currency(connection, "PBL", 1_000_000)
    pending = create_transaction(connection, USER_ID, oats, pebbles, Decimal(1000), NOW)["id"]

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as admin_db,
        psycopg.connect(database_url, row_factory=dict_row) as owner_db,
    ):

        def assign() -> SavedCurrency:
            saved = update_currency(pebbles, ADMIN, CurrencyChanges(bot_id=bot_id), admin_db, NOW)
            admin_db.commit()

            return saved

        ownership = require_owner(owner_db, oats, OWNER_ID)
        lock_owned_bot(owner_db, ownership)
        assigning = pool.submit(assign)
        wait_until_blocked_on_a_lock(connection, admin_db.info.backend_pid)
        block_user(owner_db, owner_scope(ownership), BlockRequest(user_id=USER_ID, reason="Spam"), OWNER_ID, NOW)
        owner_db.commit()
        saved = assigning.result()

    assert saved.saved.bot is not None and saved.saved.bot.id == bot_id
    assert status_of(connection, pending) == "Cancelled"


@pytest.mark.parametrize("retire", [deactivate_currency, remove_currency], ids=["deactivation", "removal"])
def test_a_bot_refund_waits_for_a_currency_being_retired_instead_of_deadlocking(
    client: TestClient, connection: psycopg.Connection, database_url: str, retire: CurrencyRetirement
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    pebbles = create_currency(connection, "PBL", 1_000_000)
    pending = create_transaction(connection, USER_ID, oats, pebbles, Decimal(1000), NOW)["id"]
    receiving_bot = bot_of(connection, pebbles)

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as bot_db,
        psycopg.connect(database_url, row_factory=dict_row) as admin_db,
    ):

        def refund() -> None:
            patch_transaction(pending, TransactionUpdate(status="Refunded"), receiving_bot, bot_db, NOW)

        lock_exchange_sides(admin_db, {oats, pebbles})
        refunding = pool.submit(refund)
        wait_until_blocked_on_a_lock(connection, bot_db.info.backend_pid)
        retire(admin_db, pebbles, NOW)
        admin_db.commit()

        with pytest.raises(ApiError) as refused:
            refunding.result()

    assert refused.value.status == 400
    assert status_of(connection, pending) == "Cancelled"


def test_a_deactivation_waits_for_a_removal_sharing_a_pending_transaction_instead_of_deadlocking(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    pebbles = create_currency(connection, "PBL", 1_000_000)
    pending = create_transaction(connection, USER_ID, oats, pebbles, Decimal(1000), NOW)["id"]

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as deactivating_db,
        psycopg.connect(database_url, row_factory=dict_row) as admin_db,
    ):

        def deactivate() -> None:
            with deactivating_db.transaction():
                deactivate_currency(deactivating_db, oats, NOW)

        lock_exchange_sides(admin_db, {oats, pebbles})
        deactivating = pool.submit(deactivate)
        wait_until_blocked_on_a_lock(connection, deactivating_db.info.backend_pid)
        remove_currency(admin_db, pebbles, NOW)
        admin_db.commit()
        deactivating.result()

    states = connection.execute("SELECT abbreviation, active, removed_at FROM currencies ORDER BY abbreviation")
    assert status_of(connection, pending) == "Cancelled"
    assert states.fetchall() == [
        {"abbreviation": "OAT", "active": False, "removed_at": None},
        {"abbreviation": "PBL", "active": False, "removed_at": NOW},
    ]


def test_an_owner_block_waits_for_a_currency_removal_instead_of_deadlocking(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    pebbles = create_currency(connection, "PBL", 1_000_000)
    pending = create_transaction(connection, USER_ID, oats, pebbles, Decimal(1000), NOW)["id"]
    ownership = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as owner_db,
        psycopg.connect(database_url, row_factory=dict_row) as admin_db,
    ):

        def block() -> BlockResult:
            lock_owned_bot(owner_db, ownership)
            result = block_user(
                owner_db, owner_scope(ownership), BlockRequest(user_id=USER_ID, reason="Spam"), OWNER_ID, NOW
            )
            owner_db.commit()

            return result

        lock_exchange_sides(admin_db, {oats, pebbles})
        blocking = pool.submit(block)
        wait_until_blocked_on_a_lock(connection, owner_db.info.backend_pid)
        remove_currency(admin_db, pebbles, NOW)
        admin_db.commit()
        blocked = blocking.result()

    assert blocked.blocked.level == "bot"
    assert status_of(connection, pending) == "Cancelled"


def test_an_owner_block_reaches_other_bots_currencies_without_waiting_on_those_bots(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    pending = create_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)["id"]
    completed = create_transaction(connection, USER_ID, oats, gems, Decimal(1000), NOW)["id"]
    connection.execute("UPDATE transactions SET status = 'Completed', handled_at = %s WHERE id = %s", (NOW, completed))
    ownership = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)
    request = BlockRequest(user_id=USER_ID, reason="Spam", reverse=ReverseRequest(window="all", direction="both"))

    with (
        psycopg.connect(database_url, row_factory=dict_row) as holder,
        psycopg.connect(database_url, row_factory=dict_row) as owner_db,
    ):
        lock_owned_bot(holder, BotOwnership(bot_id=bot_of(connection, gems), owner_id=OWNER_ID))
        owner_db.execute(f"SET lock_timeout = '{LOCK_TIMEOUT_MS}ms'")
        lock_owned_bot(owner_db, ownership)
        block_user(owner_db, owner_scope(ownership), request, OWNER_ID, NOW)
        owner_db.commit()

    assert (status_of(connection, pending), status_of(connection, completed)) == ("Cancelled", "Reversed")


def test_an_owner_block_through_a_bot_being_removed_does_not_deadlock(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    gem_bot = bot_of(connection, gems)
    issue_api_token(connection, gem_bot)
    pending = create_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)["id"]
    completed = create_transaction(connection, USER_ID, oats, gems, Decimal(1000), NOW)["id"]
    connection.execute("UPDATE transactions SET status = 'Completed', handled_at = %s WHERE id = %s", (NOW, completed))
    ownership = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)
    request = BlockRequest(user_id=USER_ID, reason="Spam", reverse=ReverseRequest(window="all", direction="both"))

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as admin_db,
        psycopg.connect(database_url, row_factory=dict_row) as owner_db,
    ):

        def remove() -> None:
            with admin_db.transaction():
                remove_bot(admin_db, gem_bot, NOW)

        lock_owned_bot(owner_db, ownership)
        lock_exchange_sides(owner_db, {oats, gems})
        removing = pool.submit(remove)
        wait_until_blocked_on_a_lock(connection, admin_db.info.backend_pid)
        block_user(owner_db, owner_scope(ownership), request, OWNER_ID, NOW)
        owner_db.commit()
        removing.result()

    assert (status_of(connection, pending), status_of(connection, completed)) == ("Cancelled", "Reversed")
    assert connection.execute("SELECT removed_at FROM bots WHERE id = %s", (gem_bot,)).fetchone()["removed_at"] == NOW


def test_a_trade_racing_an_owner_block_waits_and_is_refused(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    ownership = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as bot_db,
        psycopg.connect(database_url, row_factory=dict_row) as owner_db,
    ):

        def trade() -> None:
            with bot_db.transaction():
                create_transaction(bot_db, USER_ID, gems, oats, Decimal(1000), NOW)

        lock_owned_bot(owner_db, ownership)
        block_user(owner_db, owner_scope(ownership), BlockRequest(user_id=USER_ID, reason="Spam"), OWNER_ID, NOW)
        trading = pool.submit(trade)
        wait_until_blocked_on_a_lock(connection, bot_db.info.backend_pid)
        owner_db.commit()

        with pytest.raises(ApiError) as refused:
            trading.result()

    assert (refused.value.status, refused.value.field) == (403, "userId")
    assert connection.execute("SELECT count(*) AS trades FROM transactions").fetchone() == {"trades": 0}


def pending_deliveries(connection: psycopg.Connection) -> int:
    return connection.execute("SELECT count(*) AS waiting FROM webhook_deliveries WHERE state = 'pending'").fetchone()[
        "waiting"
    ]


def remove_the_bot(db: psycopg.Connection, bot_id: UUID) -> None:
    remove_bot(db, bot_id, NOW)


def hand_the_bot_over(db: psycopg.Connection, bot_id: UUID) -> None:
    update_bot(bot_id, ADMIN, BotChanges(owner_id=USER_ID), db)


@pytest.mark.parametrize("revoke", [remove_the_bot, hand_the_bot_over], ids=["bot removal", "owner change"])
def test_a_trade_committed_while_its_bot_loses_its_webhook_leaves_no_webhook_waiting(
    client: TestClient, connection: psycopg.Connection, database_url: str, revoke: BotRevocation
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    oat_bot = bot_of(connection, oats)
    connect_webhook(connection, oats)

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as admin_db,
        psycopg.connect(database_url, row_factory=dict_row) as trade_db,
    ):

        def revoke_in_a_transaction() -> None:
            with admin_db.transaction():
                revoke(admin_db, oat_bot)

        create_transaction(trade_db, USER_ID, gems, oats, Decimal(1000), NOW)
        revoking = pool.submit(revoke_in_a_transaction)
        wait_until_blocked_on_a_lock(connection, admin_db.info.backend_pid)
        trade_db.commit()
        revoking.result()

    assert pending_deliveries(connection) == 0


def test_a_resend_waits_for_a_refund_in_progress_and_is_refused(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    connect_webhook(connection, oats)
    pending = create_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)["id"]
    connection.execute("DELETE FROM webhook_deliveries")
    owner = User(id=OWNER_ID, username=None, avatar_hash=None, is_admin=False)

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as owner_db,
        psycopg.connect(database_url, row_factory=dict_row) as bot_db,
    ):

        def resend() -> None:
            with owner_db.transaction():
                resend_webhook(pending, owner, owner_db, NOW)

        patch_transaction(pending, TransactionUpdate(status="Refunded"), bot_of(connection, oats), bot_db, NOW)
        resending = pool.submit(resend)
        wait_until_blocked_on_a_lock(connection, owner_db.info.backend_pid)
        bot_db.commit()

        with pytest.raises(ApiError) as refused:
            resending.result()

    assert (refused.value.status, refused.value.message) == (400, "Only Pending transactions can be resent.")
    assert pending_deliveries(connection) == 0
