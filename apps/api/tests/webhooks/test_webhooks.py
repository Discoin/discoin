import hashlib
import hmac
import json
from datetime import timedelta
from uuid import UUID

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.bots.tokens import issue_api_token
from app.core.secret_box import SecretBox
from app.owners.routes import webhook_sender
from app.webhooks.delivery import SIGNATURE_HEADER, WebhookSender, deliver_due_webhooks, retry_delay
from tests.factories import FIRST_ADMIN_ID, NOW, OWNER_ID, USER_ID, WEBHOOK_SECRET_KEY, create_currency, log_in

HOOK_URL = "https://bot.example.com/discoin"
BOX = SecretBox.from_base64(WEBHOOK_SECRET_KEY)


class Receiver:
    def __init__(self, statuses: list[int]) -> None:
        self.statuses = statuses
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]

        return httpx.Response(status)

    def sender(self) -> WebhookSender:
        return WebhookSender(httpx.Client(transport=httpx.MockTransport(self)), BOX)


@pytest.fixture
def pair(client: TestClient, connection: psycopg.Connection) -> tuple[UUID, UUID]:
    return create_currency(connection, "RCH", 1_000_000), create_currency(connection, "POR", 100_000)


def connect_webhook(connection: psycopg.Connection, currency_id: UUID) -> str:
    secret = "whsec_test"
    connection.execute(
        "UPDATE currencies SET webhook_url = %s, webhook_secret_sealed = %s WHERE id = %s",
        (HOOK_URL, BOX.seal(secret, str(currency_id)), currency_id),
    )

    return secret


def convert(client: TestClient, connection: psycopg.Connection, source: UUID, target: UUID) -> dict:
    response = client.post(
        "/transactions",
        headers={"Authorization": f"Bearer {issue_api_token(connection, source)}"},
        json={"userId": USER_ID, "toCurrencyId": str(target), "amount": 1000},
    )

    return response.json()


def delivery_states(connection: psycopg.Connection) -> list[dict]:
    return connection.execute(
        "SELECT event, state, attempt, last_status, next_attempt_at FROM webhook_deliveries ORDER BY id"
    ).fetchall()


def test_retry_schedule_doubles_from_ten_seconds_up_to_an_hour() -> None:
    delays = [retry_delay(failed).total_seconds() for failed in range(1, 11)]

    assert delays == [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 3600]
    assert sum(delays) / 3600 == pytest.approx(2.42, abs=0.01)


def test_new_transaction_is_delivered_signed(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    secret = connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    receiver = Receiver([200])

    assert deliver_due_webhooks(connection, receiver.sender(), NOW) == 1

    request = receiver.requests[0]
    timestamp, digest = (part.split("=", 1)[1] for part in request.headers[SIGNATURE_HEADER].split(","))
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + request.content, hashlib.sha256).hexdigest()
    body = json.loads(request.content)
    assert str(request.url) == HOOK_URL
    assert hmac.compare_digest(digest, expected)
    assert body["event"] == "transaction.created"
    assert body["transaction"]["id"] == created["id"]
    assert body["transaction"]["userId"] == USER_ID
    assert delivery_states(connection)[0]["state"] == "delivered"


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
    deliver_due_webhooks(connection, receiver.sender(), NOW + timedelta(seconds=9))
    retry = delivery_states(connection)[0]
    deliver_due_webhooks(connection, receiver.sender(), NOW + timedelta(seconds=10))

    assert retry["state"] == "pending"
    assert retry["last_status"] == 500
    assert retry["next_attempt_at"] == NOW + timedelta(seconds=10)
    assert len(receiver.requests) == 2
    assert delivery_states(connection)[0]["state"] == "delivered"


def test_delivery_stops_after_ten_retries_and_leaves_the_transaction(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    receiver = Receiver([503])
    moment = NOW

    for _ in range(15):
        deliver_due_webhooks(connection, receiver.sender(), moment)
        moment += timedelta(hours=1)

    final = delivery_states(connection)[0]
    pending = client.get(
        "/transactions/pending", headers={"Authorization": f"Bearer {issue_api_token(connection, poor)}"}
    )

    assert len(receiver.requests) == 11
    assert (final["state"], final["attempt"]) == ("exhausted", 11)
    assert [transaction["id"] for transaction in pending.json()] == [created["id"]]


def test_unreachable_receiver_counts_as_a_failure(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    convert(client, connection, rich, poor)

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    deliver_due_webhooks(connection, WebhookSender(httpx.Client(transport=httpx.MockTransport(refuse)), BOX), NOW)

    row = connection.execute("SELECT state, last_error FROM webhook_deliveries").fetchone()
    assert row == {"state": "pending", "last_error": "ConnectError: connection refused"}


def test_removed_url_fails_the_attempt(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    convert(client, connection, rich, poor)
    connection.execute("UPDATE currencies SET webhook_url = NULL")
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
    log_in(client, connection, OWNER_ID)

    first = client.post(f"/currencies/{poor}/webhook-secret").json()["secret"]
    second = client.post(f"/currencies/{poor}/webhook-secret").json()["secret"]

    stored = connection.execute("SELECT webhook_secret_sealed FROM currencies WHERE id = %s", (poor,)).fetchone()
    assert first != second
    assert second.startswith("whsec_")
    assert second not in stored["webhook_secret_sealed"]
    assert BOX.open(stored["webhook_secret_sealed"], str(poor)) == second


@pytest.mark.parametrize("user_id", [USER_ID, FIRST_ADMIN_ID])
def test_only_the_owner_can_regenerate_the_secret(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], user_id: str
) -> None:
    _, poor = pair
    log_in(client, connection, user_id)

    assert client.post(f"/currencies/{poor}/webhook-secret").status_code == 403


def test_owner_resends_a_pending_transaction(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/transactions/{created['id']}/resend-webhook")

    assert response.status_code == 204
    assert [delivery["event"] for delivery in delivery_states(connection)] == ["created", "resend"]


def test_resend_needs_a_webhook_url(client: TestClient, connection: psycopg.Connection, pair: tuple) -> None:
    rich, poor = pair
    created = convert(client, connection, rich, poor)
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/transactions/{created['id']}/resend-webhook")

    assert response.status_code == 400
    assert response.json()["message"].startswith("Add a webhook URL")


def test_resend_only_pending(client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    connection.execute("UPDATE transactions SET status = 'Completed', handled_at = %s", (NOW,))
    log_in(client, connection, OWNER_ID)

    assert client.post(f"/transactions/{created['id']}/resend-webhook").status_code == 400


def test_resend_is_for_the_receiving_owner_only(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connect_webhook(connection, poor)
    created = convert(client, connection, rich, poor)
    log_in(client, connection, USER_ID)

    assert client.post(f"/transactions/{created['id']}/resend-webhook").status_code == 403


def test_resend_unknown_transaction_is_404(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, OWNER_ID)

    assert client.post("/transactions/019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21/resend-webhook").status_code == 404


def use_receiver(client: TestClient, receiver: Receiver) -> None:
    client.app.dependency_overrides[webhook_sender] = receiver.sender


def test_owner_sends_a_signed_test_webhook(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    _, poor = pair
    secret = connect_webhook(connection, poor)
    receiver = Receiver([204])
    use_receiver(client, receiver)
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/currencies/{poor}/webhook-test")

    request = receiver.requests[0]
    timestamp, digest = (part.split("=", 1)[1] for part in request.headers[SIGNATURE_HEADER].split(","))
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + request.content, hashlib.sha256).hexdigest()
    body = json.loads(request.content)
    assert (response.status_code, response.json()) == (200, {"status": 204})
    assert hmac.compare_digest(digest, expected)
    assert body["event"] == "transaction.test"
    assert body["transaction"]["toCurrencyId"] == str(poor)
    assert body["transaction"]["userId"] == OWNER_ID


def test_test_webhook_saves_nothing(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    _, poor = pair
    connect_webhook(connection, poor)
    use_receiver(client, Receiver([200]))
    log_in(client, connection, OWNER_ID)

    client.post(f"/currencies/{poor}/webhook-test")

    counts = connection.execute(
        "SELECT (SELECT count(*) FROM transactions) AS transactions, (SELECT count(*) FROM webhook_deliveries) AS deliveries"
    ).fetchone()
    assert counts == {"transactions": 0, "deliveries": 0}


def test_test_webhook_reports_a_failing_endpoint(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    _, poor = pair
    connect_webhook(connection, poor)
    use_receiver(client, Receiver([500]))
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/currencies/{poor}/webhook-test")

    assert response.status_code == 502
    assert response.json()["message"] == "Your webhook answered 500. Discoin expects a 2xx answer."


def test_test_webhook_reports_an_unreachable_endpoint(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    _, poor = pair
    connect_webhook(connection, poor)

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client.app.dependency_overrides[webhook_sender] = lambda: WebhookSender(
        httpx.Client(transport=httpx.MockTransport(refuse)), BOX
    )
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/currencies/{poor}/webhook-test")

    assert response.status_code == 502
    assert response.json()["message"].startswith("Discoin couldn't reach your webhook.")


def test_test_webhook_needs_a_saved_url(client: TestClient, connection: psycopg.Connection, pair: tuple) -> None:
    _, poor = pair
    log_in(client, connection, OWNER_ID)

    response = client.post(f"/currencies/{poor}/webhook-test")

    assert (response.status_code, response.json()["field"]) == (400, "webhookUrl")


@pytest.mark.parametrize("user_id", [USER_ID, FIRST_ADMIN_ID])
def test_only_the_owner_sends_test_webhooks(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], user_id: str
) -> None:
    _, poor = pair
    connect_webhook(connection, poor)
    log_in(client, connection, user_id)

    assert client.post(f"/currencies/{poor}/webhook-test").status_code == 403
