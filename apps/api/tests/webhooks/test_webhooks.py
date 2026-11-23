import hashlib
import hmac
import json
from collections.abc import Callable
from datetime import timedelta
from uuid import UUID

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.bots.tokens import issue_api_token
from app.owners.routes import webhook_sender
from app.webhooks.delivery import SIGNATURE_HEADER, WebhookSender, deliver_due_webhooks, retry_delay
from tests.factories import (
    ADMIN_ID,
    NOW,
    OWNER_ID,
    UNKNOWN_ID,
    USER_ID,
    bot_of,
    create_botless_currency,
    feed_events,
    log_in,
)
from tests.webhooks.receiver import BOX, HOOK_URL, Receiver, connect_webhook

NIL_UUID = "00000000-0000-0000-0000-000000000000"
RETRY_WAITS = [timedelta(minutes=minutes) for minutes in (1, 2, 4, 8, 16, 32, 64)]


def bot_token(connection: psycopg.Connection, currency_id: UUID) -> str:
    return issue_api_token(connection, bot_of(connection, currency_id))


def convert(client: TestClient, connection: psycopg.Connection, source: UUID, target: UUID) -> dict:
    response = client.post(
        "/transactions",
        headers={"Authorization": f"Bearer {bot_token(connection, source)}"},
        json={"userId": USER_ID, "fromCurrencyId": str(source), "toCurrencyId": str(target), "amount": 1000},
    )

    return response.json()


def share_bot(connection: psycopg.Connection, currency_id: UUID, abbreviation: str) -> UUID:
    sibling = create_botless_currency(connection, abbreviation, 100_000)
    connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (bot_of(connection, currency_id), sibling))

    return sibling


def verified_body(request: httpx.Request, secret: str) -> dict:
    expected = hmac.new(secret.encode(), request.content, hashlib.sha256).hexdigest()
    assert hmac.compare_digest(request.headers[SIGNATURE_HEADER], expected)

    return json.loads(request.content)


def delivery_states(connection: psycopg.Connection) -> list[dict]:
    return connection.execute(
        "SELECT event, state, attempt, last_status, next_attempt_at FROM webhook_deliveries ORDER BY id"
    ).fetchall()


def refuse_connection(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("connection refused", request=request)


def test_retry_schedule_doubles_from_one_minute_to_127_minutes_in_total() -> None:
    delays = [retry_delay(failed) for failed in range(1, 8)]

    assert delays == RETRY_WAITS
    assert sum(delays, timedelta()) == timedelta(minutes=127)


def test_new_transaction_is_delivered_signed(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    secret = connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    receiver = Receiver([200])

    assert deliver_due_webhooks(connection, receiver.sender(), NOW) == 1

    request = receiver.requests[0]
    body = verified_body(request, secret)
    assert str(request.url) == HOOK_URL
    assert body["event"] == "transaction.created"
    assert body["transaction"]["id"] == created["id"]
    assert body["transaction"]["userId"] == USER_ID
    assert delivery_states(connection)[0]["state"] == "delivered"


def test_signature_header_is_only_the_hex_hmac_of_the_raw_body(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    secret = connect_webhook(connection, poor)
    convert(client, connection, rich, poor)
    receiver = Receiver([200])

    deliver_due_webhooks(connection, receiver.sender(), NOW)

    request = receiver.requests[0]
    header = request.headers[SIGNATURE_HEADER]
    assert header == hmac.new(secret.encode(), request.content, hashlib.sha256).hexdigest()
    assert not any(old_format_part in header for old_format_part in ("t=", "v1=", ","))


def test_every_currency_of_a_bot_delivers_to_the_bot_webhook(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    sibling = share_bot(connection, poor, "SIB")
    secret = connect_webhook(connection, poor)
    into_poor = convert(client, connection, rich, poor)
    into_sibling = convert(client, connection, rich, sibling)
    convert(client, connection, poor, rich)
    receiver = Receiver([200])

    assert deliver_due_webhooks(connection, receiver.sender(), NOW) == 2

    bodies = [verified_body(request, secret) for request in receiver.requests]
    assert [str(request.url) for request in receiver.requests] == [HOOK_URL, HOOK_URL]
    assert [body["transaction"]["id"] for body in bodies] == [into_poor["id"], into_sibling["id"]]
    assert [body["transaction"]["fromCurrencyId"] for body in bodies] == [str(rich), str(rich)]
    assert [body["transaction"]["toCurrencyId"] for body in bodies] == [str(poor), str(sibling)]


def test_no_delivery_without_a_webhook_url(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    convert(client, connection, rich, poor)

    assert delivery_states(connection) == []


def test_failed_delivery_is_retried_on_schedule(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    convert(client, connection, rich, poor)
    receiver = Receiver([500, 200])

    deliver_due_webhooks(connection, receiver.sender(), NOW)
    deliver_due_webhooks(connection, receiver.sender(), NOW + timedelta(seconds=59))
    retry = delivery_states(connection)[0]
    deliver_due_webhooks(connection, receiver.sender(), NOW + timedelta(minutes=1))

    assert retry["state"] == "pending"
    assert retry["last_status"] == 500
    assert retry["next_attempt_at"] == NOW + timedelta(minutes=1)
    assert len(receiver.requests) == 2
    assert delivery_states(connection)[0]["state"] == "delivered"


def test_delivery_makes_eight_attempts_on_the_schedule_then_stops_and_leaves_the_transaction(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    receiver = Receiver([503])
    moment = NOW
    waits = []

    for _ in RETRY_WAITS:
        deliver_due_webhooks(connection, receiver.sender(), moment)
        retry = delivery_states(connection)[0]
        deliver_due_webhooks(connection, receiver.sender(), retry["next_attempt_at"] - timedelta(seconds=1))
        waits.append(retry["next_attempt_at"] - moment)
        moment = retry["next_attempt_at"]

    before_the_last_attempt = (retry["state"], len(receiver.requests))
    deliver_due_webhooks(connection, receiver.sender(), moment)
    deliver_due_webhooks(connection, receiver.sender(), moment + timedelta(days=1))

    final = delivery_states(connection)[0]
    pending = client.get(
        "/transactions/pending",
        params={"currencyId": str(poor)},
        headers={"Authorization": f"Bearer {bot_token(connection, poor)}"},
    )

    assert waits == RETRY_WAITS
    assert before_the_last_attempt == ("pending", 7)
    assert len(receiver.requests) == 8
    assert (final["state"], final["attempt"]) == ("exhausted", 8)
    assert [transaction["id"] for transaction in pending.json()] == [created["id"]]


def test_unreachable_receiver_counts_as_a_failure(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    convert(client, connection, rich, poor)
    sender = WebhookSender(httpx.Client(transport=httpx.MockTransport(refuse_connection)), BOX)

    deliver_due_webhooks(connection, sender, NOW)

    row = connection.execute("SELECT state, last_error FROM webhook_deliveries").fetchone()
    assert row == {"state": "pending", "last_error": "ConnectError: connection refused"}


def test_removed_url_fails_the_attempt(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    convert(client, connection, rich, poor)
    connection.execute("UPDATE bots SET webhook_url = NULL")
    receiver = Receiver([200])

    deliver_due_webhooks(connection, receiver.sender(), NOW)

    assert receiver.requests == []
    assert connection.execute("SELECT last_error FROM webhook_deliveries").fetchone()["last_error"] == (
        "The webhook URL was removed."
    )


def test_owner_regenerates_the_webhook_secret(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    _, poor = pair
    bot_id = bot_of(connection, poor)
    log_in(client, connection, OWNER_ID)

    first = client.post(f"/bots/{bot_id}/webhook-secret").json()["secret"]
    second = client.post(f"/bots/{bot_id}/webhook-secret").json()["secret"]

    stored = connection.execute("SELECT webhook_secret_sealed FROM bots WHERE id = %s", (bot_id,)).fetchone()
    assert first != second
    assert second.startswith("whsec_")
    assert second not in stored["webhook_secret_sealed"]
    assert BOX.open(stored["webhook_secret_sealed"], str(bot_id)) == second


@pytest.mark.parametrize("into_sibling", [False, True], ids=["webhook currency", "other currency of the bot"])
def test_owner_resends_a_pending_transaction(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], into_sibling: bool
) -> None:
    rich, poor = pair
    target = share_bot(connection, poor, "SIB") if into_sibling else poor
    connect_webhook(connection, poor)
    created = convert(client, connection, rich, target)
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/transactions/{created['id']}/resend-webhook")

    assert response.status_code == 204
    assert [delivery["event"] for delivery in delivery_states(connection)] == ["created", "resend"]


def test_resend_without_a_webhook_url_adds_a_feed_event(
    client: TestClient, connection: psycopg.Connection, pair: tuple
) -> None:
    rich, poor = pair
    created = convert(client, connection, rich, poor)
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/transactions/{created['id']}/resend-webhook")

    resent = connection.execute("SELECT payload FROM bot_events WHERE id = 2").fetchone()["payload"]
    assert response.status_code == 204
    assert feed_events(connection, bot_of(connection, poor)) == [(1, "transaction.created"), (2, "transaction.created")]
    assert resent["transaction"]["id"] == created["id"]
    assert delivery_states(connection) == []


def test_resend_only_pending(client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    connection.execute("UPDATE transactions SET status = 'Completed', handled_at = %s", (NOW,))
    log_in(client, connection, OWNER_ID)

    assert client.post(f"/transactions/{created['id']}/resend-webhook").status_code == 400


@pytest.mark.parametrize("sender_owner", [USER_ID, "600000000000000006"])
def test_resend_is_for_the_receiving_owner_only(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], sender_owner: str
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    connection.execute("UPDATE bots SET owner_id = %s WHERE id = %s", (sender_owner, bot_of(connection, rich)))
    connection.execute("UPDATE bots SET owner_id = %s WHERE id = %s", (ADMIN_ID, bot_of(connection, poor)))
    log_in(client, connection, sender_owner)

    assert client.post(f"/transactions/{created['id']}/resend-webhook").status_code == 403


def test_resend_unknown_transaction_is_404(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, OWNER_ID)

    assert client.post(f"/transactions/{UNKNOWN_ID}/resend-webhook").status_code == 404


def use_receiver(client: TestClient, receiver: Receiver) -> None:
    client.app.dependency_overrides[webhook_sender] = receiver.sender


def test_owner_sends_a_signed_test_webhook_for_the_bot(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    _, poor = pair
    secret = connect_webhook(connection, poor)
    receiver = Receiver([204])
    use_receiver(client, receiver)
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/bots/{bot_of(connection, poor)}/webhook-test")

    body = verified_body(receiver.requests[0], secret)
    counts = connection.execute(
        "SELECT (SELECT count(*) FROM transactions) AS transactions, (SELECT count(*) FROM webhook_deliveries) AS deliveries"
    ).fetchone()
    assert (response.status_code, response.json()) == (200, {"status": 204})
    assert body["event"] == "transaction.test"
    assert (body["transaction"]["fromCurrencyId"], body["transaction"]["toCurrencyId"]) == (NIL_UUID, NIL_UUID)
    assert body["transaction"]["userId"] == OWNER_ID
    assert counts == {"transactions": 0, "deliveries": 0}


@pytest.mark.parametrize(
    ("answer", "message"),
    [
        (Receiver([500]), "Your webhook answered 500. Discoin expects a 2xx answer."),
        (refuse_connection, "Discoin couldn't reach your webhook."),
    ],
    ids=["failing", "unreachable"],
)
def test_test_webhook_reports_a_failing_endpoint(
    client: TestClient,
    connection: psycopg.Connection,
    pair: tuple[UUID, UUID],
    answer: Callable[[httpx.Request], httpx.Response],
    message: str,
) -> None:
    _, poor = pair
    connect_webhook(connection, poor)
    client.app.dependency_overrides[webhook_sender] = lambda: WebhookSender(
        httpx.Client(transport=httpx.MockTransport(answer)), BOX
    )
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/bots/{bot_of(connection, poor)}/webhook-test")

    assert response.status_code == 502
    assert response.json()["message"].startswith(message)


def test_test_without_a_webhook_url_adds_a_feed_event(
    client: TestClient, connection: psycopg.Connection, pair: tuple
) -> None:
    _, poor = pair
    receiver = Receiver([204])
    use_receiver(client, receiver)
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/bots/{bot_of(connection, poor)}/webhook-test")

    stored = connection.execute("SELECT id, event, payload FROM bot_events").fetchall()
    assert (response.status_code, response.json()) == (200, {"status": None})
    assert [(event["id"], event["event"]) for event in stored] == [(1, "transaction.test")]
    assert stored[0]["payload"]["event"] == "transaction.test"
    assert {**stored[0]["payload"]["transaction"], "id": None, "submittedAt": None} == {
        "id": None,
        "userId": OWNER_ID,
        "fromCurrencyId": NIL_UUID,
        "toCurrencyId": NIL_UUID,
        "amount": 100.0,
        "payout": 10.0,
        "status": "Pending",
        "submittedAt": None,
        "handledAt": None,
    }
    assert receiver.requests == []
    assert delivery_states(connection) == []
