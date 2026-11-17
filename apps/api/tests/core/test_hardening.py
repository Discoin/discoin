import json
import logging
from datetime import timedelta
from decimal import Decimal

import httpx
import psycopg
import pytest
from cryptography.exceptions import InvalidTag
from fastapi.testclient import TestClient

from app.core.logs import JsonFormatter
from app.core.rate_limit import RateLimiter
from app.core.secret_box import InvalidKeyError, SecretBox
from app.main import create_app
from app.transactions.ledger import create_transaction as ledger_create
from app.webhooks.delivery import WebhookSender, deliver_due_webhooks
from app.webhooks.public_transport import PublicAddressTransport
from tests.factories import (
    FIRST_ADMIN_ID,
    FRONTEND_ORIGIN,
    NOW,
    OWNER_ID,
    USER_ID,
    WEBHOOK_SECRET_KEY,
    bot_of,
    create_currency,
    create_transaction,
    log_in,
)
from tests.webhooks.receiver import connect_unreadable_webhook

BOX = SecretBox.from_base64(WEBHOOK_SECRET_KEY)


def test_secret_box_round_trips_and_binds_to_its_context() -> None:
    box = SecretBox.from_base64(WEBHOOK_SECRET_KEY)
    sealed = box.seal("whsec_abc", "currency-1")

    assert "whsec_abc" not in sealed
    assert box.open(sealed, "currency-1") == "whsec_abc"
    with pytest.raises(InvalidTag):
        box.open(sealed, "currency-2")


@pytest.mark.parametrize("key", ["c2hvcnQ=", "not base64!"])
def test_startup_rejects_a_bad_webhook_key(api_environment: None, monkeypatch: pytest.MonkeyPatch, key: str) -> None:
    monkeypatch.setenv("WEBHOOK_SECRET_KEY", key)

    with pytest.raises(InvalidKeyError):
        create_app()


@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1"])
def test_webhook_transport_refuses_private_addresses(address: str) -> None:
    transport = PublicAddressTransport(resolver=lambda host: [address])

    with httpx.Client(transport=transport) as http, pytest.raises(httpx.ConnectError, match="private address"):
        http.post("https://bot.example.com/hook")


@pytest.mark.parametrize("url", ["https://127.0.0.1/hook", "https://localhost/hook", "https://[::1]/hook"])
def test_webhook_url_cannot_point_at_a_private_host(
    client: TestClient, connection: psycopg.Connection, url: str
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    log_in(client, connection, OWNER_ID)
    bot_id = bot_of(connection, currency_id)
    client.post(f"/bots/{bot_id}/webhook-secret")

    response = client.put(f"/bots/{bot_id}/webhook-url", json={"webhookUrl": url})

    assert (response.status_code, response.json()["field"]) == (400, "webhookUrl")


def test_cors_allows_only_the_dashboard(client: TestClient) -> None:
    preflight = {"Access-Control-Request-Method": "POST"}

    allowed = client.options("/auth/logout", headers={"Origin": FRONTEND_ORIGIN, **preflight})
    refused = client.options("/auth/logout", headers={"Origin": "https://evil.example.com", **preflight})

    assert allowed.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert "access-control-allow-origin" not in refused.headers


@pytest.mark.parametrize("origin", ["https://evil.example.com", None])
def test_session_writes_must_come_from_the_dashboard(
    client: TestClient, connection: psycopg.Connection, origin: str | None
) -> None:
    log_in(client, connection, USER_ID)
    client.headers.pop("Origin")
    headers = {} if origin is None else {"Origin": origin}

    response = client.post("/auth/logout", headers=headers)

    assert response.status_code == 403
    assert connection.execute("SELECT count(*) AS sessions FROM sessions").fetchone()["sessions"] == 1


def test_rate_limit_answers_429_with_retry_after(client: TestClient) -> None:
    client.app.state.address_limiter = RateLimiter(limit=2, window_seconds=60)

    statuses = [client.get("/currencies").status_code for _ in range(3)]
    limited = client.get("/currencies")

    assert statuses == [200, 200, 429]
    assert limited.headers["retry-after"] == "60"
    assert limited.json()["status"] == 429
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("prefix", ["", "/api"])
def test_health_is_never_rate_limited_and_other_paths_are(client: TestClient, prefix: str) -> None:
    client.app.state.address_limiter = RateLimiter(limit=1, window_seconds=60)
    proxied = TestClient(client.app, root_path=prefix)

    health = [proxied.get(f"{prefix}/health").status_code for _ in range(3)]
    currencies = [proxied.get(f"{prefix}/currencies").status_code for _ in range(2)]

    assert health == [200, 200, 200]
    assert currencies == [200, 429]


def test_rate_limit_counts_each_credential_separately() -> None:
    limiter = RateLimiter(limit=1, window_seconds=60)

    assert limiter.admit("bot-a")
    assert not limiter.admit("bot-a")
    assert limiter.admit("bot-b")


def test_transaction_lists_page_with_a_cursor(client: TestClient, connection: psycopg.Connection) -> None:
    oats = create_currency(connection, "OAT", 100_000)
    gems = create_currency(connection, "GEM", 100_000)
    ids = [str(create_transaction(connection, oats, gems, NOW - timedelta(hours=hours))) for hours in range(5)]

    first = client.get("/transactions", params={"limit": 2}).json()
    second = client.get("/transactions", params={"limit": 2, "before": first[-1]["id"]}).json()

    assert [row["id"] for row in first] == ids[:2]
    assert [row["id"] for row in second] == ids[2:4]


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"limit": 0}, "limit"),
        ({"limit": 101}, "limit"),
        ({"before": "019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21"}, "before"),
    ],
)
def test_bad_page_parameters_are_400(client: TestClient, params: dict, field: str) -> None:
    response = client.get("/transactions", params=params)

    assert (response.status_code, response.json()["field"]) == (400, field)


def test_openapi_documents_the_error_shape_and_no_422(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()

    responses = [operation["responses"] for path in schema["paths"].values() for operation in path.values()]

    assert "ErrorBody" in schema["components"]["schemas"]
    assert "HTTPValidationError" not in schema["components"]["schemas"]
    assert all("422" not in response and "default" in response for response in responses)


def test_logs_are_json_with_extra_fields() -> None:
    record = logging.makeLogRecord({"name": "discoin.http", "msg": "request", "levelname": "INFO", "status": 200})

    entry = json.loads(JsonFormatter().format(record))

    assert (entry["logger"], entry["message"], entry["status"]) == ("discoin.http", "request", 200)


def test_made_up_credentials_do_not_escape_the_address_limit(client: TestClient) -> None:
    client.app.state.address_limiter = RateLimiter(limit=3, window_seconds=60)

    statuses = [
        client.get("/currencies", headers={"Authorization": f"Bearer made-up-{attempt}"}).status_code
        for attempt in range(4)
    ]

    assert statuses == [200, 200, 200, 429]


def test_valid_credential_has_its_own_limit(client: TestClient, connection: psycopg.Connection) -> None:
    client.app.state.credential_limiter = RateLimiter(limit=1, window_seconds=60)
    log_in(client, connection, USER_ID)

    assert [client.get("/me").status_code for _ in range(2)] == [200, 429]


def test_unexpected_errors_use_the_error_shape(api_environment: None, connection: psycopg.Connection) -> None:
    application = create_app()

    @application.get("/explode")
    def explode() -> None:
        raise RuntimeError("boom")

    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.get("/explode")

    assert response.status_code == 500
    assert response.json() == {
        "status": 500,
        "message": "Something went wrong on our side. Try again in a moment.",
        "field": None,
    }
    assert "cache-control" not in response.headers


def test_webhook_transport_reports_unresolvable_hosts() -> None:
    def fail(host: str) -> list[str]:
        raise OSError("name not known")

    transport = PublicAddressTransport(resolver=fail)

    with httpx.Client(transport=transport) as http, pytest.raises(httpx.ConnectError, match="resolve"):
        http.post("https://missing.example.com/hook")


def test_unreadable_secret_is_a_failed_attempt(client: TestClient, connection: psycopg.Connection) -> None:
    rich = create_currency(connection, "RCH", 1_000_000)
    poor = create_currency(connection, "POR", 100_000)
    connect_unreadable_webhook(connection, poor)
    log_in(client, connection, OWNER_ID)
    token = client.post(f"/bots/{bot_of(connection, rich)}/api-token").json()["token"]
    client.post(
        "/transactions",
        headers={"Authorization": f"Bearer {token}"},
        json={"userId": USER_ID, "fromCurrencyId": str(rich), "toCurrencyId": str(poor), "amount": 1000},
    )
    sender = WebhookSender(httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200))), BOX)

    deliver_due_webhooks(connection, sender, NOW)

    row = connection.execute("SELECT state, last_error FROM webhook_deliveries").fetchone()
    assert row["state"] == "pending"
    assert row["last_error"].startswith("The webhook secret could not be read")


def test_latest_value_follows_the_last_write_at_the_same_instant(
    client: TestClient, connection: psycopg.Connection
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    for _ in range(2):
        created = ledger_create(connection, USER_ID, gems, oats, Decimal(1000), NOW)
        connection.execute(
            "UPDATE transactions SET status = 'Completed', handled_at = %s WHERE id = %s", (NOW, created["id"])
        )

    log_in(client, connection, FIRST_ADMIN_ID)
    client.post("/admin/blocks", json={"userId": USER_ID, "reason": "Duping", "reverse": {"window": "all"}})

    currency = client.get("/currencies/OAT").json()
    assert currency["valueHistory"][-1] == pytest.approx(100_000 / currency["reserve"])


def test_openapi_lists_only_the_endpoints_bots_use(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]

    assert sorted(paths) == [
        "/currencies",
        "/currencies/{abbreviation}",
        "/currencies/{currency_id}/history",
        "/currencies/{currency_id}/transactions",
        "/quote",
        "/transactions",
        "/transactions/pending",
        "/transactions/{transaction_id}",
    ]
    assert sorted(paths["/transactions"]) == ["get", "post"]
    assert sorted(paths["/transactions/{transaction_id}"]) == ["patch"]


def test_docs_behind_the_dashboard_proxy_load_the_schema_under_its_prefix(client: TestClient) -> None:
    prefix = "/api"
    proxied = TestClient(client.app, base_url="https://testserver", root_path=prefix)

    docs = proxied.get(f"{prefix}/docs")
    schema = proxied.get(f"{prefix}/openapi.json").json()

    assert docs.status_code == 200
    assert f"url: '{prefix}/openapi.json'" in docs.text
    assert schema["servers"] == [{"url": prefix}]
    assert "/currencies" in schema["paths"]


def test_hidden_endpoints_still_work(client: TestClient) -> None:
    assert client.get("/health").status_code == 200
    assert client.get("/me").status_code == 401
    assert client.get("/admin/currencies").status_code == 401
