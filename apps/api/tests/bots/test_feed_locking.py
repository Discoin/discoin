from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app.admin.deactivation import deactivate_currency
from app.auth.sessions import User
from app.blocking.service import GLOBAL, BlockRequest, block_user, owner_scope
from app.bots.feed import RETENTION, lock_feed, purge_expired_events
from app.core.errors import ApiError
from app.owners.access import BotOwnership, lock_owned_bot
from app.owners.routes import (
    WebhookTestResult,
    WebhookUrlUpdate,
    remove_webhook_url,
    resend_webhook,
    send_test_webhook,
    set_webhook_url,
)
from app.transactions.ledger import create_transaction
from tests.admin.test_lock_order import hand_the_bot_over, remove_the_bot, wait_until_blocked_on_a_lock
from tests.factories import (
    ADMIN_ID,
    LOCK_TIMEOUT_MS,
    NOW,
    OWNER_ID,
    USER_ID,
    bot_of,
    create_botless_currency,
    create_currency,
    feed_events,
    feed_position,
)
from tests.webhooks.receiver import BOX, HOOK_URL, TEST_SECRET, Receiver, connect_webhook

AMOUNT = Decimal(1000)
OWNER = User(id=OWNER_ID, username=None, avatar_hash=None, is_admin=False)
CREATED = "transaction.created"
CANCELLED = "transaction.cancelled"

Step = Callable[[psycopg.Connection], None]
Cancellation = Callable[[psycopg.Connection, UUID], None]
BotRevocation = Callable[[psycopg.Connection, UUID], None]


def open_connection(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row)


def sibling_of(connection: psycopg.Connection, currency_id: UUID, abbreviation: str) -> UUID:
    sibling = create_botless_currency(connection, abbreviation, 1_000_000)
    connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (bot_of(connection, currency_id), sibling))

    return sibling


def give_a_webhook_secret(connection: psycopg.Connection, bot_id: UUID) -> None:
    connection.execute(
        "UPDATE bots SET webhook_secret_sealed = %s WHERE id = %s", (BOX.seal(TEST_SECRET, str(bot_id)), bot_id)
    )


def delivered_events(connection: psycopg.Connection) -> list[str]:
    rows = connection.execute("SELECT event FROM webhook_deliveries ORDER BY id").fetchall()

    return [row["event"] for row in rows]


def committing(step: Step, db: psycopg.Connection) -> Callable[[], None]:
    def run() -> None:
        step(db)
        db.commit()

    return run


def trade(source: UUID, target: UUID, at: datetime = NOW) -> Step:
    return lambda db: create_transaction(db, USER_ID, source, target, AMOUNT, at)


def save_url(owned: BotOwnership) -> Step:
    def save(db: psycopg.Connection) -> None:
        lock_owned_bot(db, owned)
        set_webhook_url(owned, WebhookUrlUpdate(webhook_url=HOOK_URL), db)

    return save


def remove_url(owned: BotOwnership) -> Step:
    def remove(db: psycopg.Connection) -> None:
        lock_owned_bot(db, owned)
        remove_webhook_url(owned, db)

    return remove


def resend(transaction_id: UUID) -> Step:
    return lambda db: resend_webhook(transaction_id, OWNER, db, NOW)


def run_second_while_first_is_uncommitted(
    database_url: str, observer: psycopg.Connection, first: Step, second: Step
) -> None:
    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        open_connection(database_url) as second_db,
        open_connection(database_url) as first_db,
    ):
        first(first_db)
        waiting = pool.submit(committing(second, second_db))
        wait_until_blocked_on_a_lock(observer, second_db.info.backend_pid)
        first_db.commit()
        waiting.result()


def test_a_later_event_gets_its_id_only_after_the_earlier_one_commits(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    sibling = sibling_of(connection, oats, "SIB")
    gems = create_currency(connection, "GEM", 1_000_000)
    rubies = create_currency(connection, "RBY", 1_000_000)
    oat_bot = bot_of(connection, oats)

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        open_connection(database_url) as second_db,
        open_connection(database_url) as first_db,
    ):
        create_transaction(first_db, USER_ID, gems, oats, AMOUNT, NOW)
        second_trade = pool.submit(committing(trade(rubies, sibling), second_db))
        wait_until_blocked_on_a_lock(connection, second_db.info.backend_pid)
        seen_while_the_first_is_uncommitted = feed_events(connection, oat_bot)
        first_db.commit()
        second_trade.result()

    stored = connection.execute("SELECT id, payload FROM bot_events WHERE bot_id = %s ORDER BY id", (oat_bot,))
    assert seen_while_the_first_is_uncommitted == []
    assert [(row["id"], row["payload"]["transaction"]["toCurrencyId"]) for row in stored.fetchall()] == [
        (1, str(oats)),
        (2, str(sibling)),
    ]


def test_a_trade_writes_its_event_without_waiting_on_the_receiving_bots_row(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    oat_bot = bot_of(connection, oats)

    with open_connection(database_url) as holder, open_connection(database_url) as trade_db:
        lock_owned_bot(holder, BotOwnership(bot_id=oat_bot, owner_id=OWNER_ID))
        trade_db.execute(f"SET lock_timeout = '{LOCK_TIMEOUT_MS}ms'")
        create_transaction(trade_db, USER_ID, gems, oats, AMOUNT, NOW)
        trade_db.commit()

    assert feed_events(connection, oat_bot) == [(1, CREATED)]


def deactivate_the_source(db: psycopg.Connection, source: UUID) -> None:
    deactivate_currency(db, source, NOW)


def deactivation_of(source: UUID) -> Step:
    return lambda db: deactivate_the_source(db, source)


def block_the_user_everywhere(db: psycopg.Connection, source: UUID) -> None:
    block_user(db, GLOBAL, BlockRequest(user_id=USER_ID, reason="Spam"), ADMIN_ID, NOW)


@pytest.mark.parametrize("cancel", [deactivate_the_source, block_the_user_everywhere], ids=["deactivation", "block"])
def test_events_for_several_bots_take_their_feeds_in_bot_id_order(
    client: TestClient, connection: psycopg.Connection, database_url: str, cancel: Cancellation
) -> None:
    lower = create_currency(connection, "LOW", 1_000_000)
    higher = create_currency(connection, "HIG", 1_000_000)
    source = create_currency(connection, "SRC", 1_000_000)
    lower_bot, higher_bot = bot_of(connection, lower), bot_of(connection, higher)
    create_transaction(connection, USER_ID, source, lower, AMOUNT, NOW - timedelta(minutes=1))
    create_transaction(connection, USER_ID, source, higher, AMOUNT, NOW)

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        open_connection(database_url) as cancelling_db,
        open_connection(database_url) as holder,
        open_connection(database_url) as prober,
    ):
        lock_feed(holder, lower_bot)
        cancelling = pool.submit(committing(lambda db: cancel(db, source), cancelling_db))
        wait_until_blocked_on_a_lock(connection, cancelling_db.info.backend_pid)
        prober.execute("SELECT 1 FROM bot_feeds WHERE bot_id = %s FOR NO KEY UPDATE NOWAIT", (higher_bot,))
        prober.rollback()
        holder.rollback()
        cancelling.result()

    assert lower_bot < higher_bot
    assert feed_events(connection, lower_bot) == [(1, CREATED), (2, CANCELLED)]
    assert feed_events(connection, higher_bot) == [(1, CREATED), (2, CANCELLED)]


def test_two_cancellations_reaching_the_same_bots_in_opposite_order_both_finish(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    lower = create_currency(connection, "LOW", 1_000_000)
    higher = create_currency(connection, "HIG", 1_000_000)
    lower_sibling = sibling_of(connection, lower, "LOS")
    higher_sibling = sibling_of(connection, higher, "HIS")
    higher_first = create_currency(connection, "SRA", 1_000_000)
    lower_first = create_currency(connection, "SRB", 1_000_000)
    earlier = NOW - timedelta(minutes=1)
    create_transaction(connection, USER_ID, higher_first, lower, AMOUNT, earlier)
    create_transaction(connection, USER_ID, higher_first, higher, AMOUNT, NOW)
    create_transaction(connection, USER_ID, lower_first, higher_sibling, AMOUNT, earlier)
    create_transaction(connection, USER_ID, lower_first, lower_sibling, AMOUNT, NOW)

    with (
        ThreadPoolExecutor(max_workers=2) as pool,
        open_connection(database_url) as lower_first_db,
        open_connection(database_url) as higher_first_db,
        open_connection(database_url) as holder,
    ):
        lock_feed(holder, bot_of(connection, lower))
        cancellations = []

        for source, db in ((lower_first, lower_first_db), (higher_first, higher_first_db)):
            cancellations.append(pool.submit(committing(deactivation_of(source), db)))
            wait_until_blocked_on_a_lock(connection, db.info.backend_pid)

        holder.rollback()

        for cancellation in cancellations:
            cancellation.result()

    cancelled = connection.execute("SELECT count(*) AS events FROM bot_events WHERE event = %s", (CANCELLED,))
    assert cancelled.fetchone() == {"events": 4}


def test_a_resend_and_a_trade_into_the_same_bot_wait_for_each_other(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    sibling = sibling_of(connection, oats, "SIB")
    gems = create_currency(connection, "GEM", 1_000_000)
    rubies = create_currency(connection, "RBY", 1_000_000)
    pending = create_transaction(connection, USER_ID, gems, oats, AMOUNT, NOW)["id"]

    run_second_while_first_is_uncommitted(database_url, connection, trade(rubies, sibling), resend(pending))
    run_second_while_first_is_uncommitted(database_url, connection, resend(pending), trade(rubies, sibling))

    assert feed_events(connection, bot_of(connection, oats)) == [(event_id, CREATED) for event_id in range(1, 6)]


def test_a_resend_takes_its_bots_row_before_the_transaction_row(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    pending = create_transaction(connection, USER_ID, gems, oats, AMOUNT, NOW)["id"]

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        open_connection(database_url) as owner_db,
        open_connection(database_url) as holder,
        open_connection(database_url) as prober,
    ):
        holder.execute("SELECT 1 FROM transactions WHERE id = %s FOR UPDATE", (pending,))
        resending = pool.submit(committing(resend(pending), owner_db))
        wait_until_blocked_on_a_lock(connection, owner_db.info.backend_pid)

        with pytest.raises(psycopg.errors.LockNotAvailable):
            prober.execute("SELECT 1 FROM bots WHERE id = %s FOR NO KEY UPDATE NOWAIT", (bot_of(connection, oats),))

        prober.rollback()
        holder.rollback()
        resending.result()

    assert feed_events(connection, bot_of(connection, oats)) == [(1, CREATED), (2, CREATED)]


def test_a_resend_waits_for_an_owner_block_on_its_bot_and_is_refused(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    pending = create_transaction(connection, USER_ID, gems, oats, AMOUNT, NOW)["id"]
    ownership = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)

    def block(db: psycopg.Connection) -> None:
        lock_owned_bot(db, ownership)
        block_user(db, owner_scope(ownership), BlockRequest(user_id=USER_ID, reason="Spam"), OWNER_ID, NOW)

    with pytest.raises(ApiError) as refused:
        run_second_while_first_is_uncommitted(database_url, connection, block, resend(pending))

    assert (refused.value.status, refused.value.message) == (400, "Only Pending transactions can be resent.")
    assert feed_events(connection, ownership.bot_id) == [(1, CREATED), (2, CANCELLED)]


def test_an_event_written_before_a_url_save_is_cleared_by_the_save(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    owned = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)
    give_a_webhook_secret(connection, owned.bot_id)

    run_second_while_first_is_uncommitted(database_url, connection, trade(gems, oats), save_url(owned))

    assert feed_events(connection, owned.bot_id) == []
    assert delivered_events(connection) == []
    assert feed_position(connection, owned.bot_id) == {"last_event_id": 1, "acknowledged_event_id": 1}


def test_an_event_written_during_a_url_save_goes_to_the_webhook(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    owned = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)
    give_a_webhook_secret(connection, owned.bot_id)

    run_second_while_first_is_uncommitted(database_url, connection, save_url(owned), trade(gems, oats))

    assert feed_events(connection, owned.bot_id) == []
    assert delivered_events(connection) == ["created"]
    assert feed_position(connection, owned.bot_id) == {"last_event_id": 0, "acknowledged_event_id": 0}


def test_an_event_written_before_a_url_removal_stays_with_the_webhook(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    owned = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)
    connect_webhook(connection, oats)

    run_second_while_first_is_uncommitted(database_url, connection, trade(gems, oats), remove_url(owned))

    assert delivered_events(connection) == ["created"]
    assert feed_events(connection, owned.bot_id) == []


def test_an_event_written_during_a_url_removal_goes_to_the_feed(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    owned = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)
    connect_webhook(connection, oats)

    run_second_while_first_is_uncommitted(database_url, connection, remove_url(owned), trade(gems, oats))

    assert delivered_events(connection) == []
    assert feed_events(connection, owned.bot_id) == [(1, CREATED)]


def test_a_test_requested_during_a_url_save_goes_to_the_webhook(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    owned = BotOwnership(bot_id=bot_of(connection, oats), owner_id=OWNER_ID)
    give_a_webhook_secret(connection, owned.bot_id)
    receiver = Receiver([200])
    results: list[WebhookTestResult] = []

    def send_test(db: psycopg.Connection) -> None:
        results.append(send_test_webhook(owned, receiver.sender(), db, NOW))

    run_second_while_first_is_uncommitted(database_url, connection, save_url(owned), send_test)

    assert results == [WebhookTestResult(status=200)]
    assert len(receiver.requests) == 1
    assert feed_events(connection, owned.bot_id) == []


@pytest.mark.parametrize("revoke", [remove_the_bot, hand_the_bot_over], ids=["bot removal", "owner change"])
def test_an_event_committed_while_its_bot_is_revoked_is_deleted_with_the_feed(
    client: TestClient, connection: psycopg.Connection, database_url: str, revoke: BotRevocation
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    oat_bot = bot_of(connection, oats)

    run_second_while_first_is_uncommitted(database_url, connection, trade(gems, oats), lambda db: revoke(db, oat_bot))

    position = feed_position(connection, oat_bot)
    assert feed_events(connection, oat_bot) == []
    assert position["acknowledged_event_id"] == position["last_event_id"] >= 1


def test_a_purge_skips_a_feed_that_is_being_written_instead_of_waiting(
    client: TestClient, connection: psycopg.Connection, database_url: str
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    oat_bot = bot_of(connection, oats)
    create_transaction(connection, USER_ID, gems, oats, AMOUNT, NOW)
    after_expiry = NOW + RETENTION + timedelta(seconds=1)
    connection.execute(f"SET lock_timeout = '{LOCK_TIMEOUT_MS}ms'")

    with open_connection(database_url) as holder:
        lock_feed(holder, oat_bot)
        purge_expired_events(connection, after_expiry)
        kept_while_held = feed_events(connection, oat_bot)

    purge_expired_events(connection, after_expiry)

    assert kept_while_held == [(1, CREATED)]
    assert feed_events(connection, oat_bot) == []
