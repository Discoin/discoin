from collections.abc import Callable
from datetime import timedelta
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from httpx import Response

from app.bots.events import EVENTS_GO_TO_THE_WEBHOOK
from app.bots.feed import RETENTION, purge_expired_events
from app.bots.tokens import issue_api_token
from app.owners.routes import webhook_sender
from app.webhooks.delivery import deliver_due_webhooks
from tests.factories import ADMIN_ID, NOW, OWNER_ID, USER_ID, bot_of, feed_events, feed_position, log_in
from tests.webhooks.receiver import HOOK_URL, Receiver, connect_webhook

NO_TOKEN: dict[str, str] = {}
BAD_TOKEN = {"Authorization": "Bearer nope"}
EVERY_KIND_IN_THE_FEED = [
    (1, "transaction.created"),
    (2, "transaction.created"),
    (3, "transaction.created"),
    (4, "transaction.test"),
    (5, "transaction.cancelled"),
    (6, "transaction.reversed"),
]
EVERY_KIND_AS_DELIVERIES = ["created", "created", "resend", "cancelled", "reversed"]

Headers = dict[str, str]


class Market:
    def __init__(self, client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> None:
        self.client = client
        self.connection = connection
        self.rich, self.poor = pair
        self.receiving_bot = bot_of(connection, self.poor)
        self.sender = token_headers(connection, bot_of(connection, self.rich))
        self.receiver = token_headers(connection, self.receiving_bot)
        log_in(client, connection, OWNER_ID)

    def convert(self) -> dict:
        response = self.client.post(
            "/transactions",
            headers=self.sender,
            json={"userId": USER_ID, "fromCurrencyId": str(self.rich), "toCurrencyId": str(self.poor), "amount": 1000},
        )

        return response.json()

    def read(self, headers: Headers | None = None, **params: object) -> Response:
        return self.client.get("/events", headers=self.receiver if headers is None else headers, params=params)

    def read_ids(self, **params: object) -> list[int]:
        return [event["id"] for event in self.read(**params).json()["events"]]

    def acknowledge(self, event_id: object, headers: Headers | None = None) -> Response:
        return self.client.post(
            "/events/ack", headers=self.receiver if headers is None else headers, json={"id": event_id}
        )

    def as_admin(self) -> TestClient:
        log_in(self.client, self.connection, ADMIN_ID)

        return self.client

    def save_webhook_url(self) -> Response:
        self.client.post(f"/bots/{self.receiving_bot}/webhook-secret")

        return self.client.put(f"/bots/{self.receiving_bot}/webhook-url", json={"webhookUrl": HOOK_URL})

    def remove_webhook_url(self) -> Response:
        return self.client.delete(f"/bots/{self.receiving_bot}/webhook-url")

    def cause_every_kind_of_event(self) -> None:
        settled = self.convert()["id"]
        self.client.patch(f"/transactions/{settled}", headers=self.receiver, json={"status": "Completed"})
        pending = self.convert()["id"]
        self.client.post(f"/transactions/{pending}/resend-webhook")
        self.client.post(f"/bots/{self.receiving_bot}/webhook-test")
        self.as_admin().post("/admin/blocks", json={"userId": USER_ID, "reason": "Spam", "reverse": {"window": "all"}})

    def expire_every_event(self) -> None:
        purge_expired_events(self.connection, NOW + RETENTION + timedelta(seconds=1))

    def deliveries(self) -> list[str]:
        rows = self.connection.execute("SELECT event FROM webhook_deliveries ORDER BY id").fetchall()

        return [row["event"] for row in rows]

    def stored_events(self) -> list[tuple[int, str]]:
        return feed_events(self.connection, self.receiving_bot)

    def position(self) -> dict[str, int]:
        return feed_position(self.connection, self.receiving_bot)


def token_headers(connection: psycopg.Connection, bot_id: UUID) -> Headers:
    return {"Authorization": f"Bearer {issue_api_token(connection, bot_id)}"}


def refusal(response: Response) -> tuple[int, str | None]:
    return response.status_code, response.json()["field"]


@pytest.fixture
def market(client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> Market:
    return Market(client, connection, pair)


def test_an_event_is_the_webhook_body_with_amounts_as_numbers(market: Market) -> None:
    created = market.convert()

    response = market.read()

    assert response.status_code == 200
    assert response.json() == {
        "events": [
            {
                "id": 1,
                "event": "transaction.created",
                "transaction": {
                    "id": created["id"],
                    "userId": USER_ID,
                    "fromCurrencyId": str(market.rich),
                    "toCurrencyId": str(market.poor),
                    "amount": 1000.0,
                    "payout": 99.9,
                    "status": "Pending",
                    "submittedAt": created["submittedAt"],
                    "handledAt": None,
                },
            }
        ]
    }


def test_events_come_back_in_id_order_across_every_kind(market: Market) -> None:
    market.cause_every_kind_of_event()

    events = market.read().json()["events"]

    assert [(event["id"], event["event"]) for event in events] == EVERY_KIND_IN_THE_FEED
    assert [event.get("triggeredBy") for event in events[4:]] == [{"kind": "admins"}, {"kind": "admins"}]


def test_without_a_webhook_url_every_event_goes_to_the_feed_only(market: Market) -> None:
    market.cause_every_kind_of_event()

    assert market.stored_events() == EVERY_KIND_IN_THE_FEED
    assert market.deliveries() == []


def test_with_a_webhook_url_every_event_goes_to_the_webhook_only(market: Market) -> None:
    connect_webhook(market.connection, market.poor)
    test_receiver = Receiver([200])
    market.client.app.dependency_overrides[webhook_sender] = test_receiver.sender

    market.cause_every_kind_of_event()

    assert market.deliveries() == EVERY_KIND_AS_DELIVERIES
    assert len(test_receiver.requests) == 1
    assert market.stored_events() == []
    assert market.position() == {"last_event_id": 0, "acknowledged_event_id": 0}


def test_events_are_read_again_until_they_are_acknowledged(market: Market) -> None:
    market.convert()
    market.convert()

    first_read, second_read = market.read_ids(), market.read_ids()
    acknowledged = market.acknowledge(2)

    assert (first_read, second_read) == ([1, 2], [1, 2])
    assert (acknowledged.status_code, acknowledged.content) == (204, b"")
    assert market.read_ids() == []
    assert market.read_ids(after=0) == [1, 2]
    assert market.read_ids(after=1) == [2]


def test_after_does_not_move_the_cursor(market: Market) -> None:
    market.convert()
    market.convert()

    market.read_ids(after=2)

    assert market.read_ids() == [1, 2]


def test_limit_caps_the_batch_at_the_oldest_events(market: Market) -> None:
    for _ in range(3):
        market.convert()

    assert market.read_ids(limit=2) == [1, 2]
    assert market.read_ids(limit=100) == [1, 2, 3]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("limit", "0"),
        ("limit", "101"),
        ("limit", "abc"),
        ("limit", "-1"),
        ("limit", "1.5"),
        ("after", "abc"),
        ("after", "-1"),
    ],
)
def test_a_bad_parameter_is_a_422_on_that_parameter(market: Market, field: str, value: str) -> None:
    assert refusal(market.read(**{field: value})) == (422, field)


def test_acknowledging_at_or_below_the_cursor_changes_nothing(market: Market) -> None:
    market.convert()
    market.convert()
    market.acknowledge(2)

    repeated = market.acknowledge(1)

    assert repeated.status_code == 204
    assert market.position() == {"last_event_id": 2, "acknowledged_event_id": 2}


def test_acknowledging_above_the_newest_event_is_a_400(market: Market) -> None:
    market.convert()

    assert refusal(market.acknowledge(2)) == (400, "id")
    assert market.position() == {"last_event_id": 1, "acknowledged_event_id": 0}


@pytest.mark.parametrize("headers", [NO_TOKEN, BAD_TOKEN], ids=["no token", "bad token"])
def test_feed_routes_need_a_valid_token(market: Market, headers: Headers) -> None:
    assert market.read(headers).status_code == 401
    assert market.acknowledge(1, headers).status_code == 401


def test_feed_routes_refuse_a_bot_with_a_webhook_url(market: Market) -> None:
    connect_webhook(market.connection, market.poor)
    refused = {"status": 409, "message": EVENTS_GO_TO_THE_WEBHOOK, "field": None}

    responses = [market.read(), market.acknowledge(1)]

    assert EVENTS_GO_TO_THE_WEBHOOK == (
        "This bot has a webhook URL, so its events go to the webhook. "
        "Remove the URL on the Bot owner page to read events here."
    )
    assert [(response.status_code, response.json()) for response in responses] == [(409, refused), (409, refused)]


def test_checks_run_token_then_webhook_url_then_parameters(market: Market) -> None:
    connect_webhook(market.connection, market.poor)

    with_a_url = [
        market.read(BAD_TOKEN, limit="abc").status_code,
        market.acknowledge("abc", BAD_TOKEN).status_code,
        market.read(limit="abc").status_code,
        market.acknowledge("abc").status_code,
    ]
    market.connection.execute("UPDATE bots SET webhook_url = NULL")

    assert with_a_url == [401, 401, 409, 409]
    assert market.read(limit="abc").status_code == 422


def test_the_feed_starts_empty_once_the_webhook_url_is_removed(market: Market) -> None:
    connect_webhook(market.connection, market.poor)
    market.convert()

    removed = market.remove_webhook_url()
    read_after_removal = market.read_ids()
    market.convert()

    assert removed.status_code == 204
    assert read_after_removal == []
    assert market.read_ids() == [1]
    assert market.deliveries() == ["created"]


def test_events_queued_for_a_removed_webhook_url_stay_with_the_worker(market: Market) -> None:
    connect_webhook(market.connection, market.poor)
    market.convert()
    market.remove_webhook_url()
    receiver = Receiver([200])

    deliver_due_webhooks(market.connection, receiver.sender(), NOW)

    failed = market.connection.execute("SELECT state, last_error FROM webhook_deliveries").fetchone()
    assert failed == {"state": "pending", "last_error": "The webhook URL was removed."}
    assert receiver.requests == []
    assert market.stored_events() == []


def test_saving_a_webhook_url_clears_the_feed_and_ids_are_never_reused(market: Market) -> None:
    market.convert()
    market.convert()
    market.acknowledge(1)

    saved = market.save_webhook_url()
    position_with_a_url = market.position()
    market.remove_webhook_url()
    market.convert()

    assert saved.status_code == 204
    assert position_with_a_url == {"last_event_id": 2, "acknowledged_event_id": 2}
    assert market.stored_events() == [(3, "transaction.created")]
    assert market.read_ids() == [3]


def test_a_refused_webhook_url_leaves_the_feed_alone(market: Market) -> None:
    market.convert()

    refused = market.client.put(f"/bots/{market.receiving_bot}/webhook-url", json={"webhookUrl": HOOK_URL})

    assert refused.status_code == 400
    assert market.stored_events() == [(1, "transaction.created")]
    assert market.position() == {"last_event_id": 1, "acknowledged_event_id": 0}


def test_a_bot_never_sees_another_bots_events(market: Market) -> None:
    market.convert()

    as_other_bot = [market.read(market.sender), market.read(market.sender, after=0)]
    acknowledged = market.acknowledge(1, market.sender)

    assert [response.json() for response in as_other_bot] == [{"events": []}, {"events": []}]
    assert refusal(acknowledged) == (400, "id")
    assert market.read_ids() == [1]


def test_a_regenerated_token_keeps_the_cursor_and_the_unread_events(market: Market) -> None:
    market.convert()
    market.convert()
    market.acknowledge(1)
    old_token = market.receiver

    market.receiver = token_headers(market.connection, market.receiving_bot)

    assert (market.read(old_token).status_code, market.acknowledge(2, old_token).status_code) == (401, 401)
    assert market.read_ids() == [2]


def hand_over(market: Market) -> Response:
    return market.as_admin().patch(f"/admin/bots/{market.receiving_bot}", json={"ownerId": USER_ID})


def remove(market: Market) -> Response:
    return market.as_admin().delete(f"/admin/bots/{market.receiving_bot}")


@pytest.mark.parametrize("revoke", [hand_over, remove], ids=["owner change", "bot removal"])
def test_events_are_deleted_and_the_token_dies_when_the_bot_is_revoked(
    market: Market, revoke: Callable[[Market], Response]
) -> None:
    market.convert()

    revoked = revoke(market)

    position = market.position()
    assert revoked.is_success
    assert market.stored_events() == []
    assert position["acknowledged_event_id"] == position["last_event_id"] >= 1
    assert (market.read().status_code, market.acknowledge(1).status_code) == (401, 401)


def test_a_cursor_behind_the_oldest_stored_event_skips_the_expired_ones_without_an_error(market: Market) -> None:
    market.convert()
    market.convert()
    market.acknowledge(1)
    market.expire_every_event()
    market.convert()

    response = market.read()

    assert (response.status_code, response.json().keys()) == (200, {"events"})
    assert [event["id"] for event in response.json()["events"]] == [3]
    assert market.position() == {"last_event_id": 3, "acknowledged_event_id": 1}


def test_a_bot_that_never_read_gets_an_empty_list_when_everything_expired(market: Market) -> None:
    market.convert()
    market.expire_every_event()

    response = market.read()

    assert (response.status_code, response.json()) == (200, {"events": []})


def test_after_below_the_oldest_stored_event_starts_at_the_oldest_stored_one(market: Market) -> None:
    market.convert()
    market.convert()
    market.expire_every_event()
    market.convert()
    market.convert()

    assert market.read_ids(after=0) == [3, 4]
    assert market.read_ids(after=1, limit=1) == [3]


def test_acknowledging_a_purged_event_still_moves_the_cursor(market: Market) -> None:
    market.convert()
    market.convert()
    market.expire_every_event()
    market.convert()

    acknowledged = market.acknowledge(2)

    assert acknowledged.status_code == 204
    assert market.position() == {"last_event_id": 3, "acknowledged_event_id": 2}
    assert market.read_ids() == [3]


def test_purge_removes_only_events_older_than_24_hours(market: Market) -> None:
    for _ in range(3):
        market.convert()

    age = "UPDATE bot_events SET created_at = %s WHERE id = %s"
    market.connection.execute(age, (NOW - RETENTION - timedelta(seconds=1), 1))
    market.connection.execute(age, (NOW - RETENTION, 2))

    purge_expired_events(market.connection, NOW)

    assert [event_id for event_id, _ in market.stored_events()] == [2, 3]
