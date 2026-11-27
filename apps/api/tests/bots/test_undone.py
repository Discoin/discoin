from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from httpx import Response
from psycopg.rows import dict_row

from app.core.database import current_time
from app.transactions.queries import mark_undone_handled
from app.webhooks.delivery import deliver_due_webhooks
from tests.admin.test_lock_order import wait_until_blocked_on_a_lock
from tests.bots.test_bot import bot_headers
from tests.factories import (
    ADMIN_ID,
    NOW,
    UNKNOWN_ID,
    USER_ID,
    bot_of,
    create_botless_currency,
    create_currency,
    create_transaction,
    deactivate,
    log_in,
    remove_currency,
)
from tests.webhooks.receiver import Receiver, connect_webhook

LATER = NOW + timedelta(hours=1)
EARLIER = NOW - timedelta(hours=1)

Headers = dict[str, str]


class Exchange:
    def __init__(self, client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> None:
        self.client = client
        self.connection = connection
        self.rich, self.poor = pair
        self.sender = bot_headers(connection, self.rich)
        self.receiver = bot_headers(connection, self.poor)

    def add(self, status: str, at: datetime = NOW) -> str:
        return str(create_transaction(self.connection, self.rich, self.poor, at, status))

    def read(self, headers: Headers, **params: object) -> Response:
        return self.client.get("/transactions/undone", headers=headers, params=params)

    def undone_ids(self, headers: Headers, **params: object) -> list[str]:
        return [transaction["id"] for transaction in self.read(headers, **params).json()]

    def mark(self, headers: Headers, transaction_id: str) -> Response:
        return self.client.put(f"/transactions/{transaction_id}/handled", headers=headers)

    def handled_times(self, transaction_id: str) -> dict[str, datetime | None]:
        return self.connection.execute(
            "SELECT receiver_handled_at, sender_handled_at FROM transactions WHERE id = %s", (transaction_id,)
        ).fetchone()

    def give_the_sending_bot(self, currency_id: UUID) -> None:
        self.connection.execute(
            "UPDATE currencies SET bot_id = %s WHERE id = %s", (bot_of(self.connection, self.rich), currency_id)
        )


@pytest.fixture
def exchange(client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> Exchange:
    return Exchange(client, connection, pair)


@pytest.mark.parametrize(
    ("status", "owed_by_receiver", "owed_by_sender"),
    [
        ("Pending", False, False),
        ("Completed", False, False),
        ("Refunded", False, True),
        ("Cancelled", True, True),
        ("Reversed", True, True),
    ],
)
def test_each_side_lists_and_marks_only_what_was_undone_for_it(
    exchange: Exchange, status: str, owed_by_receiver: bool, owed_by_sender: bool
) -> None:
    transaction = exchange.add(status)

    for headers, owed in ((exchange.receiver, owed_by_receiver), (exchange.sender, owed_by_sender)):
        listed = exchange.undone_ids(headers)
        marked = exchange.mark(headers, transaction)

        assert listed == ([transaction] if owed else [])
        assert marked.status_code == (204 if owed else 400)


def test_an_item_is_a_bot_transaction_with_amounts_as_numbers(exchange: Exchange) -> None:
    transaction = exchange.add("Reversed")

    response = exchange.read(exchange.receiver)

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": transaction,
            "userId": USER_ID,
            "fromCurrencyId": str(exchange.rich),
            "toCurrencyId": str(exchange.poor),
            "amount": 100.0,
            "payout": 10.0,
            "status": "Reversed",
            "submittedAt": "2026-11-13T12:00:00Z",
            "handledAt": "2026-11-13T12:00:00Z",
            "fromCurrency": {"abbreviation": "RCH", "name": "RCH coin", "removed": False},
            "toCurrency": {"abbreviation": "POR", "name": "POR coin", "removed": False},
        }
    ]


def test_marking_answers_with_no_body_and_takes_the_item_off_the_list(exchange: Exchange) -> None:
    transaction = exchange.add("Reversed")

    marked = exchange.mark(exchange.receiver, transaction)

    assert (marked.status_code, marked.content) == (204, b"")
    assert exchange.undone_ids(exchange.receiver) == []


def test_each_bot_marks_its_own_side_only(exchange: Exchange) -> None:
    transaction = exchange.add("Cancelled")

    exchange.mark(exchange.receiver, transaction)

    assert exchange.undone_ids(exchange.receiver) == []
    assert exchange.undone_ids(exchange.sender) == [transaction]
    assert exchange.handled_times(transaction) == {"receiver_handled_at": NOW, "sender_handled_at": None}

    exchange.mark(exchange.sender, transaction)

    assert exchange.undone_ids(exchange.sender) == []
    assert exchange.handled_times(transaction) == {"receiver_handled_at": NOW, "sender_handled_at": NOW}


def test_a_bot_on_both_sides_gets_one_item_and_one_mark_clears_both(exchange: Exchange) -> None:
    exchange.give_the_sending_bot(exchange.poor)
    transaction = exchange.add("Reversed")

    listed = exchange.undone_ids(exchange.sender)
    marked = exchange.mark(exchange.sender, transaction)

    assert listed == [transaction]
    assert marked.status_code == 204
    assert exchange.handled_times(transaction) == {"receiver_handled_at": NOW, "sender_handled_at": NOW}
    assert exchange.undone_ids(exchange.sender) == []


def test_a_bot_on_both_sides_marks_a_refund_on_its_sending_side_only(exchange: Exchange) -> None:
    exchange.give_the_sending_bot(exchange.poor)
    transaction = exchange.add("Refunded")

    from_its_source = exchange.undone_ids(exchange.sender, currencyId=str(exchange.rich))
    from_its_target = exchange.undone_ids(exchange.sender, currencyId=str(exchange.poor))
    exchange.mark(exchange.sender, transaction)

    assert (from_its_source, from_its_target) == ([transaction], [])
    assert exchange.handled_times(transaction) == {"receiver_handled_at": None, "sender_handled_at": NOW}


def test_a_bot_on_neither_side_never_sees_or_marks_the_transaction(
    exchange: Exchange, connection: psycopg.Connection
) -> None:
    transaction = exchange.add("Reversed")
    stranger = bot_headers(connection, create_currency(connection, "GEM", 1_000_000))

    listed = exchange.read(stranger)
    marked = exchange.mark(stranger, transaction)

    assert (listed.status_code, listed.json()) == (200, [])
    assert (marked.status_code, marked.json()["field"]) == (403, None)
    assert exchange.handled_times(transaction) == {"receiver_handled_at": None, "sender_handled_at": None}


def test_both_routes_need_a_valid_token(exchange: Exchange) -> None:
    transaction = exchange.add("Reversed")

    for headers in ({}, {"Authorization": "Bearer nope"}):
        assert exchange.read(headers).status_code == 401
        assert exchange.mark(headers, transaction).status_code == 401


def test_marking_an_unknown_or_malformed_transaction_is_refused(exchange: Exchange) -> None:
    assert exchange.mark(exchange.receiver, UNKNOWN_ID).status_code == 404
    assert exchange.mark(exchange.receiver, "nope").status_code == 400


def test_marking_again_keeps_the_first_time(exchange: Exchange, client: TestClient) -> None:
    transaction = exchange.add("Reversed")
    exchange.mark(exchange.receiver, transaction)
    client.app.dependency_overrides[current_time] = lambda: LATER

    repeated = exchange.mark(exchange.receiver, transaction)

    assert repeated.status_code == 204
    assert exchange.handled_times(transaction)["receiver_handled_at"] == NOW


def test_a_mark_racing_another_waits_and_keeps_the_first_time(exchange: Exchange, database_url: str) -> None:
    transaction = UUID(exchange.add("Reversed"))
    receiving_bot = bot_of(exchange.connection, exchange.poor)

    def mark_later(db: psycopg.Connection) -> None:
        mark_undone_handled(db, transaction, receiving_bot, LATER)
        db.commit()

    with (
        ThreadPoolExecutor(max_workers=1) as pool,
        psycopg.connect(database_url, row_factory=dict_row) as second_db,
        psycopg.connect(database_url, row_factory=dict_row) as first_db,
    ):
        mark_undone_handled(first_db, transaction, receiving_bot, NOW)
        waiting = pool.submit(mark_later, second_db)
        wait_until_blocked_on_a_lock(exchange.connection, second_db.info.backend_pid)
        first_db.commit()
        waiting.result()

    assert exchange.handled_times(str(transaction))["receiver_handled_at"] == NOW


def test_the_list_is_oldest_undone_first_then_by_id(exchange: Exchange) -> None:
    newest = exchange.add("Reversed", NOW)
    older = exchange.add("Cancelled", EARLIER)
    same_time = exchange.add("Reversed", EARLIER)
    undone_last = exchange.add("Reversed", EARLIER)
    exchange.connection.execute("UPDATE transactions SET handled_at = %s WHERE id = %s", (LATER, undone_last))

    assert exchange.undone_ids(exchange.receiver) == [older, same_time, newest, undone_last]


def test_marking_each_batch_drains_the_list(exchange: Exchange) -> None:
    undone = [exchange.add("Reversed", NOW + timedelta(minutes=minute)) for minute in range(3)]
    batches = []

    while batch := exchange.undone_ids(exchange.receiver, limit=2):
        batches.append(batch)

        for transaction in batch:
            exchange.mark(exchange.receiver, transaction)

    assert batches == [undone[:2], undone[2:]]


def test_an_unmarked_item_comes_first_on_every_call(exchange: Exchange) -> None:
    first = exchange.add("Reversed", EARLIER)
    exchange.add("Reversed", NOW)

    assert exchange.undone_ids(exchange.receiver, limit=1) == [first]
    assert exchange.undone_ids(exchange.receiver, limit=1) == [first]


def test_the_list_holds_50_items_unless_told_otherwise(exchange: Exchange) -> None:
    for _ in range(51):
        exchange.add("Reversed")

    assert len(exchange.undone_ids(exchange.receiver)) == 50
    assert len(exchange.undone_ids(exchange.receiver, limit=100)) == 51


@pytest.mark.parametrize("limit", ["0", "101", "many"])
def test_a_limit_outside_1_to_100_is_refused(exchange: Exchange, limit: str) -> None:
    response = exchange.read(exchange.receiver, limit=limit)

    assert (response.status_code, response.json()["field"]) == (400, "limit")


def test_currency_filter_matches_the_bots_side_of_each_transaction(
    exchange: Exchange, connection: psycopg.Connection
) -> None:
    gems = create_botless_currency(connection, "GEM", 1_000_000)
    exchange.give_the_sending_bot(gems)
    out_of_rich = exchange.add("Cancelled", EARLIER)
    into_gems = str(create_transaction(connection, exchange.poor, gems, NOW, "Cancelled"))

    assert exchange.undone_ids(exchange.sender, currencyId=str(exchange.rich)) == [out_of_rich]
    assert exchange.undone_ids(exchange.sender, currencyId=str(gems)) == [into_gems]
    assert exchange.undone_ids(exchange.sender) == [out_of_rich, into_gems]


@pytest.mark.parametrize(
    ("currency", "status"), [("malformed", 400), ("unknown", 404), ("removed", 404), ("another bot's", 403)]
)
def test_currency_filter_needs_one_of_the_bots_live_currencies(
    exchange: Exchange, connection: psycopg.Connection, currency: str, status: int
) -> None:
    currency_id = {
        "malformed": "nope",
        "unknown": UNKNOWN_ID,
        "removed": str(exchange.rich),
        "another bot's": str(exchange.poor),
    }[currency]

    if currency == "removed":
        remove_currency(connection, exchange.rich)

    response = exchange.read(exchange.sender, currencyId=currency_id)

    assert (response.status_code, response.json()["field"]) == (status, "currencyId")


def test_a_removed_currency_is_still_listed_and_marked_without_the_filter(
    exchange: Exchange, connection: psycopg.Connection
) -> None:
    transaction = exchange.add("Cancelled")
    remove_currency(connection, exchange.poor)

    listed = exchange.read(exchange.receiver).json()
    marked = exchange.mark(exchange.receiver, transaction)

    assert [(item["id"], item["toCurrency"]["removed"]) for item in listed] == [(transaction, True)]
    assert marked.status_code == 204


def test_an_inactive_currency_is_still_listed_with_and_without_the_filter(
    exchange: Exchange, connection: psycopg.Connection
) -> None:
    transaction = exchange.add("Cancelled")
    deactivate(connection, exchange.rich)

    assert exchange.undone_ids(exchange.sender) == [transaction]
    assert exchange.undone_ids(exchange.sender, currencyId=str(exchange.rich)) == [transaction]


@pytest.mark.parametrize("delivery", ["feed", "webhook"])
def test_a_delivered_or_handled_event_does_not_hide_the_item(
    exchange: Exchange, client: TestClient, connection: psycopg.Connection, delivery: str
) -> None:
    if delivery == "webhook":
        connect_webhook(connection, exchange.poor)

    created = client.post(
        "/transactions",
        headers=exchange.sender,
        json={
            "userId": USER_ID,
            "fromCurrencyId": str(exchange.rich),
            "toCurrencyId": str(exchange.poor),
            "amount": 1000,
        },
    ).json()["id"]
    client.patch(f"/transactions/{created}", headers=exchange.receiver, json={"status": "Completed"})
    log_in(client, connection, ADMIN_ID)
    client.post("/admin/blocks", json={"userId": USER_ID, "reason": "Spam", "reverse": {"window": "all"}})

    if delivery == "webhook":
        receiver = Receiver([200])
        deliver_due_webhooks(connection, receiver.sender(), NOW)
        delivered = [request.read() for request in receiver.requests]
    else:
        delivered = client.post("/events/claim", headers=exchange.receiver).json()["events"]
        for event in delivered:
            client.post(f"/events/{event['id']}/result", headers=exchange.receiver, json={"handled": True})

    assert len(delivered) == 2
    assert exchange.undone_ids(exchange.receiver) == [created]
    assert exchange.undone_ids(exchange.sender) == [created]


def test_the_new_routes_leave_the_other_transaction_routes_reachable(exchange: Exchange, client: TestClient) -> None:
    pending = exchange.add("Pending")
    undone = exchange.add("Reversed")

    assert [row["id"] for row in client.get("/transactions/pending", headers=exchange.receiver).json()] == [pending]
    assert exchange.undone_ids(exchange.receiver) == [undone]
    assert client.get("/transactions/undone").status_code == 401
    assert len(client.get("/transactions").json()) == 2
    assert client.get(f"/transactions/{undone}").json()["status"] == "Reversed"
    assert client.put("/transactions/undone/handled", headers=exchange.receiver).status_code == 400
    settled = client.patch(f"/transactions/{pending}", headers=exchange.receiver, json={"status": "Completed"})
    assert settled.json()["status"] == "Completed"
