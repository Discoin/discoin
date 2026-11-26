import json
from datetime import datetime, timedelta
from uuid import UUID

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient
from httpx import Response

from app.bots.feed import purge_expired_events
from app.owners.routes import webhook_sender
from app.webhooks.delivery import WebhookSender
from app.webhooks.webhook_tests import TEST_LIFETIME
from tests.bots.test_bot import bot_headers
from tests.factories import NOW, OWNER_ID, UNKNOWN_ID, bot_of, log_in, reserve_of
from tests.webhooks.receiver import BOX, Receiver, connect_webhook

NIL_UUID = "00000000-0000-0000-0000-000000000000"
NOW_TEXT = "2026-11-13T12:00:00Z"
TEST_CURRENCY = {"abbreviation": "TEST", "name": "Test", "removed": False}
JUST_EXPIRED = NOW - TEST_LIFETIME - timedelta(seconds=1)
ABOUT_TO_EXPIRE = NOW - TEST_LIFETIME
ONLY_PENDING = "Only Pending transactions can be marked Completed or Refunded."
MOVING_PARTS = """
    SELECT (SELECT count(*) FROM transactions) AS transactions,
        (SELECT count(*) FROM webhook_deliveries) AS deliveries,
        (SELECT count(*) FROM bot_events) AS events,
        (SELECT count(*) FROM currency_history) AS history_points
"""

Headers = dict[str, str]


class BotUnderTest:
    def __init__(self, client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> None:
        self.client = client
        self.connection = connection
        self.rich, self.poor = pair
        self.bot_id = bot_of(connection, self.poor)
        self.other_bot_id = bot_of(connection, self.rich)
        self.token = bot_headers(connection, self.poor)
        self.other_token = bot_headers(connection, self.rich)
        log_in(client, connection, OWNER_ID)

    def start(self) -> str:
        return self.client.post(f"/bots/{self.bot_id}/webhook-test").json()["testId"]

    def start_on_a_webhook(self) -> str:
        connect_webhook(self.connection, self.poor)
        self.client.app.dependency_overrides[webhook_sender] = Receiver([204]).sender

        return self.start()

    def progress(self, test_id: str, bot_id: UUID | None = None) -> Response:
        return self.client.get(f"/bots/{self.bot_id if bot_id is None else bot_id}/webhook-test/{test_id}")

    def mark(self, test_id: str, status: str = "Completed", headers: Headers | None = None) -> Response:
        return self.client.patch(
            f"/transactions/{test_id}", headers=self.token if headers is None else headers, json={"status": status}
        )

    def acknowledge(self, event_id: int) -> Response:
        return self.client.post("/events/ack", headers=self.token, json={"id": event_id})

    def submit_at(self, test_id: str, submitted_at: datetime) -> None:
        self.connection.execute("UPDATE webhook_tests SET submitted_at = %s WHERE id = %s", (submitted_at, test_id))

    def stored_tests(self) -> list[str]:
        rows = self.connection.execute("SELECT id::text FROM webhook_tests ORDER BY id").fetchall()

        return [row["id"] for row in rows]


@pytest.fixture
def tested(client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> BotUnderTest:
    return BotUnderTest(client, connection, pair)


def test_a_feed_test_waits_until_the_bot_acknowledges_its_event(tested: BotUnderTest) -> None:
    test_id = tested.start()

    before_the_read = tested.progress(test_id)
    tested.acknowledge(1)

    assert (before_the_read.status_code, before_the_read.json()) == (
        200,
        {"state": "waiting", "path": "feed", "markedStatus": None},
    )
    assert tested.progress(test_id).json() == {"state": "delivered", "path": "feed", "markedStatus": None}


def test_a_webhook_test_is_delivered_as_soon_as_the_webhook_answered(tested: BotUnderTest) -> None:
    test_id = tested.start_on_a_webhook()

    assert tested.progress(test_id).json() == {"state": "delivered", "path": "webhook", "markedStatus": None}


@pytest.mark.parametrize("status", ["Completed", "Refunded"])
def test_a_marked_test_is_handled_with_the_status_the_bot_chose(tested: BotUnderTest, status: str) -> None:
    test_id = tested.start_on_a_webhook()

    tested.mark(test_id, status)

    assert tested.progress(test_id).json() == {"state": "handled", "path": "webhook", "markedStatus": status}


def test_a_feed_test_marked_without_an_acknowledgement_is_handled(tested: BotUnderTest) -> None:
    test_id = tested.start()

    tested.mark(test_id)

    assert tested.progress(test_id).json() == {"state": "handled", "path": "feed", "markedStatus": "Completed"}


def test_marking_a_test_answers_the_test_as_a_transaction_and_moves_nothing(tested: BotUnderTest) -> None:
    test_id = tested.start()
    before = tested.connection.execute(MOVING_PARTS).fetchone()

    response = tested.mark(test_id, "Refunded")

    assert (response.status_code, response.json()) == (
        200,
        {
            "id": test_id,
            "userId": OWNER_ID,
            "fromCurrencyId": NIL_UUID,
            "toCurrencyId": NIL_UUID,
            "amount": 100.0,
            "payout": 10.0,
            "status": "Refunded",
            "submittedAt": NOW_TEXT,
            "handledAt": NOW_TEXT,
            "fromCurrency": TEST_CURRENCY,
            "toCurrency": TEST_CURRENCY,
        },
    )
    assert tested.connection.execute(MOVING_PARTS).fetchone() == before
    assert (reserve_of(tested.connection, tested.rich), reserve_of(tested.connection, tested.poor)) == (
        1_000_000,
        100_000,
    )


def test_a_test_marked_during_a_webhook_call_that_then_fails_is_not_kept(tested: BotUnderTest) -> None:
    connect_webhook(tested.connection, tested.poor)
    marks: list[Response] = []

    def mark_then_fail(request: httpx.Request) -> httpx.Response:
        marks.append(tested.mark(json.loads(request.content)["transaction"]["id"]))

        return httpx.Response(500)

    tested.client.app.dependency_overrides[webhook_sender] = lambda: WebhookSender(
        httpx.Client(transport=httpx.MockTransport(mark_then_fail)), BOX
    )

    started = tested.client.post(f"/bots/{tested.bot_id}/webhook-test")

    assert [mark.status_code for mark in marks] == [200]
    assert started.status_code == 502
    assert tested.stored_tests() == []


def test_a_marked_test_cannot_be_marked_again(tested: BotUnderTest) -> None:
    test_id = tested.start()
    tested.mark(test_id, "Completed")

    again = tested.mark(test_id, "Refunded")

    assert (again.status_code, again.json()) == (400, {"status": 400, "message": ONLY_PENDING, "field": "status"})
    assert tested.progress(test_id).json()["markedStatus"] == "Completed"


def test_another_bot_cannot_mark_the_test(tested: BotUnderTest) -> None:
    test_id = tested.start()

    response = tested.mark(test_id, headers=tested.other_token)

    assert (response.status_code, response.json()["message"]) == (404, "No transaction with that ID.")
    assert tested.progress(test_id).json()["state"] == "waiting"


def test_a_test_lives_ten_minutes(tested: BotUnderTest) -> None:
    test_id = tested.start()
    tested.submit_at(test_id, ABOUT_TO_EXPIRE)

    while_live = [tested.progress(test_id).status_code, tested.mark(test_id).status_code]
    tested.submit_at(test_id, JUST_EXPIRED)

    assert TEST_LIFETIME == timedelta(minutes=10)
    assert while_live == [200, 200]
    assert [tested.progress(test_id).status_code, tested.mark(test_id).status_code] == [404, 404]


def test_an_expired_unmarked_test_cannot_be_marked(tested: BotUnderTest) -> None:
    test_id = tested.start()
    tested.submit_at(test_id, JUST_EXPIRED)

    response = tested.mark(test_id)

    assert (response.status_code, response.json()["message"]) == (404, "No transaction with that ID.")


def test_progress_is_a_404_for_an_unknown_test_and_for_another_bot(tested: BotUnderTest) -> None:
    test_id = tested.start()

    responses = [tested.progress(UNKNOWN_ID), tested.progress(test_id, tested.other_bot_id)]

    assert [response.status_code for response in responses] == [404, 404]
    assert responses[0].json() == {"status": 404, "message": "No webhook test with that ID.", "field": None}


def test_a_test_is_never_listed_or_shown_as_a_transaction(tested: BotUnderTest) -> None:
    pending_id, marked_id = tested.start(), tested.start()
    tested.mark(marked_id, "Refunded")

    lists = [
        tested.client.get("/transactions/pending", headers=tested.token),
        tested.client.get("/transactions/undone", headers=tested.token),
        tested.client.get(f"/bots/{tested.bot_id}/transactions/pending"),
        tested.client.get("/transactions"),
    ]
    details = [tested.client.get(f"/transactions/{test_id}") for test_id in (pending_id, marked_id)]

    assert [response.json() for response in lists] == [[], [], [], []]
    assert [response.status_code for response in details] == [404, 404]


def test_a_test_cannot_be_marked_handled_like_an_undone_transaction(tested: BotUnderTest) -> None:
    test_id = tested.start()
    tested.mark(test_id, "Refunded")

    response = tested.client.put(f"/transactions/{test_id}/handled", headers=tested.token)

    assert response.status_code == 404


def test_the_purge_deletes_expired_tests_only(tested: BotUnderTest) -> None:
    expired, live = tested.start(), tested.start()
    tested.submit_at(expired, JUST_EXPIRED)
    tested.submit_at(live, ABOUT_TO_EXPIRE)

    purge_expired_events(tested.connection, NOW)

    assert tested.stored_tests() == [live]
