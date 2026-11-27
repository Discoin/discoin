from collections.abc import Callable
from datetime import datetime, timedelta
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from httpx import Response

from app.bots.events import ALREADY_FINISHED, CLAIM_FIRST, EVENTS_GO_TO_THE_WEBHOOK, LAST_TRY, LEASE
from app.bots.feed import RETENTION, purge_expired_events
from app.bots.tokens import issue_api_token
from app.core.database import current_time
from app.owners.routes import webhook_sender
from app.webhooks.delivery import FIRST_RETRY_DELAY, MAX_RETRIES, deliver_due_webhooks, retry_delay
from tests.factories import ADMIN_ID, NOW, OWNER_ID, USER_ID, bot_of, feed_events, last_event_id, log_in
from tests.webhooks.receiver import HOOK_URL, Receiver, connect_webhook

NO_TOKEN: dict[str, str] = {}
BAD_TOKEN = {"Authorization": "Bearer nope"}
EVERY_KIND_IN_THE_FEED = [
    (1, "transaction.created"),
    (2, "transaction.created"),
    (3, "transaction.created"),
    (4, "transaction.created"),
    (5, "transaction.cancelled"),
    (6, "transaction.reversed"),
]
ONLY_THE_FOURTH_IS_A_TEST = [False, False, False, True, False, False]
EVERY_KIND_AS_DELIVERIES = ["created", "created", "resend", "cancelled", "reversed"]
ONE_SECOND = timedelta(seconds=1)
LONGEST_WAIT = LEASE + retry_delay(LAST_TRY)
ABOVE_BIGINT = 2**63

Headers = dict[str, str]


class Market:
    def __init__(self, client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> None:
        self.client = client
        self.connection = connection
        self.rich, self.poor = pair
        self.receiving_bot = bot_of(connection, self.poor)
        self.sender = token_headers(connection, bot_of(connection, self.rich))
        self.receiver = token_headers(connection, self.receiving_bot)
        self.now = NOW
        client.app.dependency_overrides[current_time] = lambda: self.now
        log_in(client, connection, OWNER_ID)

    def convert(self) -> dict:
        response = self.client.post(
            "/transactions",
            headers=self.sender,
            json={"userId": USER_ID, "fromCurrencyId": str(self.rich), "toCurrencyId": str(self.poor), "amount": 1000},
        )

        return response.json()

    def wait(self, duration: timedelta) -> None:
        self.now += duration

    def claim(self, headers: Headers | None = None, **params: object) -> Response:
        return self.client.post("/events/claim", headers=self.receiver if headers is None else headers, params=params)

    def claim_ids(self, **params: object) -> list[int]:
        return [event["id"] for event in self.claim(**params).json()["events"]]

    def report(self, event_id: int, result: object, headers: Headers | None = None) -> Response:
        return self.client.post(
            f"/events/{event_id}/result", headers=self.receiver if headers is None else headers, json=result
        )

    def handle(self, event_id: int) -> Response:
        return self.report(event_id, {"handled": True})

    def fail(self, event_id: int) -> Response:
        return self.report(event_id, {"handled": False})

    def use_every_try_without_reporting(self) -> list[list[int]]:
        claims = []

        for _ in range(LAST_TRY):
            claims.append(self.claim_ids())
            self.wait(LONGEST_WAIT)

        return claims

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
        purge_expired_events(self.connection, self.now + RETENTION + ONE_SECOND)

    def deliveries(self) -> list[str]:
        rows = self.connection.execute("SELECT event FROM webhook_deliveries ORDER BY id").fetchall()

        return [row["event"] for row in rows]

    def stored_events(self) -> list[tuple[int, str]]:
        return feed_events(self.connection, self.receiving_bot)

    def states(self) -> list[tuple[str, int]]:
        rows = self.connection.execute(
            "SELECT state, attempt FROM bot_events WHERE bot_id = %s ORDER BY id", (self.receiving_bot,)
        ).fetchall()

        return [(row["state"], row["attempt"]) for row in rows]

    def next_attempts(self) -> list[datetime]:
        rows = self.connection.execute(
            "SELECT next_attempt_at FROM bot_events WHERE bot_id = %s ORDER BY id", (self.receiving_bot,)
        ).fetchall()

        return [row["next_attempt_at"] for row in rows]

    def last_event_id(self) -> int:
        return last_event_id(self.connection, self.receiving_bot)


def token_headers(connection: psycopg.Connection, bot_id: UUID) -> Headers:
    return {"Authorization": f"Bearer {issue_api_token(connection, bot_id)}"}


def refusal(response: Response) -> tuple[int, str | None]:
    return response.status_code, response.json()["field"]


def conflict(message: str) -> tuple[int, dict]:
    return 409, {"status": 409, "message": message, "field": None}


def answer(response: Response) -> tuple[int, dict]:
    return response.status_code, response.json()


@pytest.fixture
def market(client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> Market:
    return Market(client, connection, pair)


def test_an_event_is_the_webhook_body_with_its_attempt_and_amounts_as_numbers(market: Market) -> None:
    created = market.convert()

    response = market.claim()

    assert response.status_code == 200
    assert response.json() == {
        "events": [
            {
                "id": 1,
                "attempt": 1,
                "event": "transaction.created",
                "test": False,
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


def test_events_are_claimed_in_id_order_across_every_kind(market: Market) -> None:
    market.cause_every_kind_of_event()

    events = market.claim().json()["events"]

    assert [(event["id"], event["event"]) for event in events] == EVERY_KIND_IN_THE_FEED
    assert [event["test"] for event in events] == ONLY_THE_FOURTH_IS_A_TEST
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

    queued = market.connection.execute("SELECT payload FROM webhook_deliveries").fetchall()
    assert market.deliveries() == EVERY_KIND_AS_DELIVERIES
    assert [delivery["payload"]["test"] for delivery in queued] == [False] * len(EVERY_KIND_AS_DELIVERIES)
    assert len(test_receiver.requests) == 1
    assert market.stored_events() == []
    assert market.last_event_id() == 0


def test_a_new_event_is_due_at_once(market: Market) -> None:
    market.convert()

    assert market.states() == [("pending", 0)]
    assert market.next_attempts() == [NOW]


def test_a_claimed_event_is_hidden_while_its_lease_runs(market: Market) -> None:
    market.convert()
    market.convert()

    first_claim, second_claim = market.claim_ids(), market.claim_ids()
    market.wait(LEASE + retry_delay(1) - ONE_SECOND)

    assert (first_claim, second_claim) == ([1, 2], [])
    assert market.claim_ids() == []


def test_an_unreported_event_comes_back_after_the_lease_plus_the_backoff(market: Market) -> None:
    market.convert()
    market.claim()

    market.wait(LEASE + retry_delay(1))
    again = market.claim().json()["events"]

    assert LEASE == timedelta(minutes=2)
    assert [(event["id"], event["attempt"]) for event in again] == [(1, 2)]
    assert market.next_attempts() == [market.now + LEASE + retry_delay(2)]


def test_limit_caps_the_claim_at_the_oldest_due_events(market: Market) -> None:
    for _ in range(3):
        market.convert()

    assert market.claim_ids(limit=2) == [1, 2]
    assert market.claim_ids(limit=100) == [3]


@pytest.mark.parametrize("value", ["0", "101", "abc", "-1", "1.5"])
def test_a_bad_limit_is_a_422_on_limit(market: Market, value: str) -> None:
    market.convert()

    assert refusal(market.claim(limit=value)) == (422, "limit")
    assert market.states() == [("pending", 0)]


def test_an_unhandled_event_comes_back_after_the_backoff_without_waiting_for_the_lease(market: Market) -> None:
    market.convert()
    market.claim()

    reported = market.fail(1)
    market.wait(retry_delay(1) - ONE_SECOND)
    before_the_backoff_ends = market.claim_ids()
    market.wait(ONE_SECOND)

    assert (reported.status_code, reported.content) == (204, b"")
    assert before_the_backoff_ends == []
    assert [(event["id"], event["attempt"]) for event in market.claim().json()["events"]] == [(1, 2)]


def test_the_backoff_doubles_with_each_unhandled_try(market: Market) -> None:
    market.convert()
    waits = []

    for _ in range(MAX_RETRIES):
        market.claim()
        market.fail(1)
        waits.append(market.next_attempts()[0] - market.now)
        market.wait(waits[-1])

    assert waits == [FIRST_RETRY_DELAY * 2**retry for retry in range(MAX_RETRIES)]
    assert market.states() == [("pending", MAX_RETRIES)]


def test_an_event_reported_unhandled_on_its_last_try_is_dead(market: Market) -> None:
    market.convert()

    for _ in range(MAX_RETRIES):
        market.claim()
        market.fail(1)
        market.wait(LONGEST_WAIT)

    last_claim = market.claim().json()["events"]
    reported = market.fail(1)
    market.wait(LONGEST_WAIT)

    assert [(event["id"], event["attempt"]) for event in last_claim] == [(1, LAST_TRY)]
    assert reported.status_code == 204
    assert market.states() == [("dead", LAST_TRY)]
    assert market.claim_ids() == []


def test_an_event_never_reported_on_its_last_try_dies_in_the_next_claim(market: Market) -> None:
    market.convert()

    claims = market.use_every_try_without_reporting()
    still_pending = market.states()
    market.convert()

    assert LAST_TRY == 8
    assert claims == [[1]] * LAST_TRY
    assert still_pending == [("pending", LAST_TRY)]
    assert market.claim_ids() == [2]
    assert market.states() == [("dead", LAST_TRY), ("pending", 1)]


def test_a_dead_event_does_not_use_up_the_limit(market: Market) -> None:
    market.convert()
    market.use_every_try_without_reporting()
    market.convert()

    assert market.claim_ids(limit=1) == [2]


def test_a_dead_event_can_still_be_reported_handled_but_not_unhandled(market: Market) -> None:
    market.convert()
    market.use_every_try_without_reporting()
    market.claim()

    unhandled = market.fail(1)
    state_after_unhandled = market.states()
    handled = market.handle(1)

    assert answer(unhandled) == conflict(ALREADY_FINISHED)
    assert state_after_unhandled == [("dead", LAST_TRY)]
    assert handled.status_code == 204
    assert market.states() == [("handled", LAST_TRY)]


def test_handled_is_final(market: Market) -> None:
    market.convert()
    market.claim()

    first, repeated = market.handle(1), market.handle(1)
    unhandled = market.fail(1)
    market.wait(LONGEST_WAIT)

    assert ((first.status_code, first.content), repeated.status_code) == ((204, b""), 204)
    assert answer(unhandled) == conflict(ALREADY_FINISHED)
    assert ALREADY_FINISHED == "This event is already finished."
    assert market.states() == [("handled", 1)]
    assert market.claim_ids() == []


@pytest.mark.parametrize("handled", [True, False])
def test_reporting_an_unclaimed_event_is_a_409(market: Market, handled: bool) -> None:
    market.convert()

    response = market.report(1, {"handled": handled})

    assert answer(response) == conflict(CLAIM_FIRST)
    assert CLAIM_FIRST == "Claim this event before reporting it."
    assert market.states() == [("pending", 0)]


def test_an_event_handled_before_it_was_ever_claimed_counts_as_finished(market: Market) -> None:
    market.convert()
    market.connection.execute("UPDATE bot_events SET state = 'handled'")

    assert market.handle(1).status_code == 204
    assert answer(market.fail(1)) == conflict(ALREADY_FINISHED)
    assert market.states() == [("handled", 0)]


@pytest.mark.parametrize("result", [{}, {"handled": "true"}, {"handled": 1}, {"handled": None}])
def test_handled_must_be_a_real_boolean(market: Market, result: dict) -> None:
    market.convert()
    market.claim()

    assert refusal(market.report(1, result)) == (400, "handled")
    assert market.states() == [("pending", 1)]


@pytest.mark.parametrize("event_id", [2, ABOVE_BIGINT])
def test_reporting_an_unknown_event_is_a_404(market: Market, event_id: int) -> None:
    market.convert()
    market.claim()

    response = market.handle(event_id)

    assert answer(response) == (404, {"status": 404, "message": "No event with that ID.", "field": None})


def test_reporting_a_purged_event_is_a_404(market: Market) -> None:
    market.convert()
    market.claim()
    market.expire_every_event()

    assert [market.handle(1).status_code, market.fail(1).status_code] == [404, 404]


def test_a_later_event_is_not_blocked_by_an_earlier_unhandled_one(market: Market) -> None:
    market.convert()
    market.convert()
    market.claim()
    market.fail(1)
    market.convert()

    later = market.claim_ids()
    handled = market.handle(3)

    assert later == [3]
    assert handled.status_code == 204
    assert market.states() == [("pending", 1), ("pending", 1), ("handled", 1)]


@pytest.mark.parametrize("headers", [NO_TOKEN, BAD_TOKEN], ids=["no token", "bad token"])
def test_feed_routes_need_a_valid_token(market: Market, headers: Headers) -> None:
    market.convert()

    assert market.claim(headers).status_code == 401
    assert market.report(1, {"handled": True}, headers).status_code == 401
    assert market.states() == [("pending", 0)]


def test_feed_routes_refuse_a_bot_with_a_webhook_url(market: Market) -> None:
    connect_webhook(market.connection, market.poor)

    responses = [market.claim(), market.handle(1)]

    assert EVENTS_GO_TO_THE_WEBHOOK == (
        "This bot has a webhook URL, so its events go to the webhook. "
        "Remove the URL on the Bot owner page to read events here."
    )
    assert [answer(response) for response in responses] == [conflict(EVENTS_GO_TO_THE_WEBHOOK)] * 2


def test_checks_run_token_then_webhook_url_then_parameters(market: Market) -> None:
    connect_webhook(market.connection, market.poor)

    with_a_url = [
        market.claim(BAD_TOKEN, limit="abc").status_code,
        market.report(1, {"handled": "abc"}, BAD_TOKEN).status_code,
        market.claim(limit="abc").status_code,
        market.report(1, {"handled": "abc"}).status_code,
    ]
    market.connection.execute("UPDATE bots SET webhook_url = NULL")

    assert with_a_url == [401, 401, 409, 409]
    assert market.claim(limit="abc").status_code == 422
    assert market.report(1, {"handled": "abc"}).status_code == 400


def test_the_feed_starts_empty_once_the_webhook_url_is_removed(market: Market) -> None:
    connect_webhook(market.connection, market.poor)
    market.convert()

    removed = market.remove_webhook_url()
    claimed_after_removal = market.claim_ids()
    market.convert()

    assert removed.status_code == 204
    assert claimed_after_removal == []
    assert market.claim_ids() == [1]
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
    market.claim(limit=1)
    market.handle(1)

    saved = market.save_webhook_url()
    last_id_with_a_url = market.last_event_id()
    market.remove_webhook_url()
    market.convert()

    assert saved.status_code == 204
    assert last_id_with_a_url == 2
    assert market.stored_events() == [(3, "transaction.created")]
    assert market.claim_ids() == [3]


def test_a_refused_webhook_url_leaves_the_feed_alone(market: Market) -> None:
    market.convert()

    refused = market.client.put(f"/bots/{market.receiving_bot}/webhook-url", json={"webhookUrl": HOOK_URL})

    assert refused.status_code == 400
    assert market.stored_events() == [(1, "transaction.created")]
    assert market.states() == [("pending", 0)]


def test_a_bot_never_claims_or_reports_another_bots_events(market: Market) -> None:
    market.convert()

    claimed_as_other_bot = market.claim(market.sender)
    market.claim()
    reported_as_other_bot = market.report(1, {"handled": True}, market.sender)

    assert claimed_as_other_bot.json() == {"events": []}
    assert reported_as_other_bot.status_code == 404
    assert market.states() == [("pending", 1)]


def test_a_regenerated_token_keeps_the_events_and_their_results(market: Market) -> None:
    market.convert()
    market.convert()
    market.claim(limit=1)
    market.handle(1)
    old_token = market.receiver

    market.receiver = token_headers(market.connection, market.receiving_bot)

    assert (market.claim(old_token).status_code, market.report(2, {"handled": True}, old_token).status_code) == (
        401,
        401,
    )
    assert market.claim_ids() == [2]
    assert market.states() == [("handled", 1), ("pending", 1)]


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

    assert revoked.is_success
    assert market.stored_events() == []
    assert market.last_event_id() >= 1
    assert (market.claim().status_code, market.handle(1).status_code) == (401, 401)


def test_a_bot_gets_an_empty_list_when_everything_expired(market: Market) -> None:
    market.convert()
    market.expire_every_event()

    response = market.claim()

    assert answer(response) == (200, {"events": []})


def test_purge_removes_events_in_every_state(market: Market) -> None:
    market.convert()
    market.use_every_try_without_reporting()

    for _ in range(3):
        market.convert()

    market.claim(limit=2)
    market.handle(2)
    states_before_the_purge = [state for state, _ in market.states()]

    market.expire_every_event()

    assert states_before_the_purge == ["dead", "handled", "pending", "pending"]
    assert market.stored_events() == []


def test_purge_removes_only_events_older_than_24_hours(market: Market) -> None:
    for _ in range(3):
        market.convert()

    age = "UPDATE bot_events SET created_at = %s WHERE id = %s"
    market.connection.execute(age, (NOW - RETENTION - ONE_SECOND, 1))
    market.connection.execute(age, (NOW - RETENTION, 2))

    purge_expired_events(market.connection, NOW)

    assert [event_id for event_id, _ in market.stored_events()] == [2, 3]
