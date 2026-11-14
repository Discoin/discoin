from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app.bots.tokens import issue_api_token
from app.transactions.ledger import create_transaction
from tests.factories import NOW, USER_ID, create_currency, deactivate

OTHER_USER_ID = "400000000000000004"


@pytest.fixture
def pair(client: TestClient, connection: psycopg.Connection) -> tuple[UUID, UUID]:
    return create_currency(connection, "RCH", 1_000_000), create_currency(connection, "POR", 100_000)


def bot_headers(connection: psycopg.Connection, currency_id: UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_api_token(connection, currency_id)}"}


def reserve_of(connection: psycopg.Connection, currency_id: UUID) -> Decimal:
    return connection.execute("SELECT reserve FROM currencies WHERE id = %s", (currency_id,)).fetchone()["reserve"]


def send(client: TestClient, headers: dict[str, str], target: UUID, amount: float, user_id: str = USER_ID) -> dict:
    response = client.post(
        "/transactions",
        headers=headers,
        json={"userId": user_id, "toCurrencyId": str(target), "amount": amount},
    )

    return {"http": response.status_code, **response.json()}


def test_create_applies_the_curve_and_saves(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair

    created = send(client, bot_headers(connection, rich), poor, 1000)

    assert created["http"] == 201
    assert created["payout"] == 99.9
    assert created["userId"] == USER_ID
    assert created["status"] == "Pending" and created["handledAt"] is None
    assert reserve_of(connection, rich) == Decimal("1001000.00")
    assert reserve_of(connection, poor) == Decimal("99900.10")
    history = connection.execute("SELECT count(*) AS points FROM currency_history").fetchone()
    assert history["points"] == 4


def test_create_needs_a_valid_token(client: TestClient, pair: tuple[UUID, UUID]) -> None:
    _, poor = pair

    assert send(client, {}, poor, 10)["http"] == 401
    assert send(client, {"Authorization": "Bearer nope"}, poor, 10)["http"] == 401


def test_regenerated_token_replaces_the_old_one(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    old = bot_headers(connection, rich)
    new = bot_headers(connection, rich)

    assert send(client, old, poor, 10)["http"] == 401
    assert send(client, new, poor, 10)["http"] == 201


def test_token_is_stored_as_a_hash_only(client: TestClient, connection: psycopg.Connection, pair: tuple) -> None:
    rich, _ = pair
    token = issue_api_token(connection, rich)

    assert token not in str(connection.execute("SELECT * FROM currencies").fetchall())


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"userId": "12", "amount": 10}, "userId"),
        ({"userId": USER_ID, "amount": 0}, "amount"),
        ({"userId": USER_ID, "amount": 1_000_000_001}, "amount"),
        ({"userId": USER_ID, "amount": 0.01}, "amount"),
        ({"userId": USER_ID}, "amount"),
    ],
)
def test_create_rejects_bad_input(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], body: dict, field: str
) -> None:
    rich, poor = pair

    response = client.post(
        "/transactions", headers=bot_headers(connection, rich), json={"toCurrencyId": str(poor), **body}
    )

    assert response.status_code == 400
    assert response.json()["field"] == field
    assert reserve_of(connection, rich) == Decimal(1_000_000)


def test_create_rejects_converting_into_itself(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, _ = pair

    assert send(client, bot_headers(connection, rich), rich, 10)["field"] == "toCurrencyId"


def test_create_rejects_an_unknown_target(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, _ = pair

    response = send(client, bot_headers(connection, rich), UUID("019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21"), 10)

    assert (response["http"], response["field"]) == (404, "toCurrencyId")


def test_create_rejects_an_inactive_currency(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    deactivate(connection, poor)

    assert send(client, bot_headers(connection, rich), poor, 10)["http"] == 400


@pytest.mark.parametrize("scope", ["global", "source", "target"])
def test_create_rejects_a_blocked_user(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], scope: str
) -> None:
    rich, poor = pair
    currency_id = {"global": None, "source": rich, "target": poor}[scope]
    connection.execute(
        "INSERT INTO blocks (user_id, currency_id, reason, blocked_by, blocked_at) VALUES (%s, %s, 'spam', %s, %s)",
        (USER_ID, currency_id, USER_ID, NOW),
    )

    response = send(client, bot_headers(connection, rich), poor, 10)

    assert (response["http"], response["field"]) == (403, "userId")


def test_unblocked_user_can_convert_again(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connection.execute(
        """
        INSERT INTO blocks (user_id, reason, blocked_by, blocked_at, unblocked_by, unblocked_at)
        VALUES (%s, 'spam', %s, %s, %s, %s)
        """,
        (USER_ID, USER_ID, NOW, USER_ID, NOW),
    )

    assert send(client, bot_headers(connection, rich), poor, 10)["http"] == 201


def test_daily_cap_rejects_with_the_most_the_user_can_send(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connection.execute("UPDATE currencies SET daily_cap = 50 WHERE id = %s", (poor,))
    headers = bot_headers(connection, rich)

    rejected = send(client, headers, poor, 1000)

    assert rejected["http"] == 400
    assert rejected["field"] == "amount"
    assert rejected["maxAmount"] == 500.25
    assert send(client, headers, poor, 500.25)["http"] == 201
    assert send(client, headers, poor, 20)["maxAmount"] == 0.1


def test_daily_cap_counts_only_this_user_in_the_last_day(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connection.execute("UPDATE currencies SET daily_cap = 50 WHERE id = %s", (poor,))
    headers = bot_headers(connection, rich)
    send(client, headers, poor, 500)

    assert send(client, headers, poor, 500, user_id=OTHER_USER_ID)["http"] == 201
    assert send(client, headers, poor, 20)["http"] == 400


def test_daily_cap_ignores_refunded_transactions(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connection.execute("UPDATE currencies SET daily_cap = 50 WHERE id = %s", (poor,))
    created = send(client, bot_headers(connection, rich), poor, 500)
    client.patch(f"/transactions/{created['id']}", headers=bot_headers(connection, poor), json={"status": "Refunded"})

    assert send(client, bot_headers(connection, rich), poor, 500)["http"] == 201


def test_pending_lists_incoming_transactions_for_the_bot(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), poor, 10)

    incoming = client.get("/transactions/pending", headers=bot_headers(connection, poor)).json()
    outgoing = client.get("/transactions/pending", headers=bot_headers(connection, rich)).json()

    assert [transaction["id"] for transaction in incoming] == [created["id"]]
    assert incoming[0]["userId"] == USER_ID
    assert outgoing == []


def test_target_bot_completes_a_transaction(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), poor, 10)

    response = client.patch(
        f"/transactions/{created['id']}", headers=bot_headers(connection, poor), json={"status": "Completed"}
    )

    assert response.json()["status"] == "Completed"
    assert response.json()["handledAt"] == "2026-11-13T12:00:00Z"


def test_refund_runs_the_payout_back_through_the_curve(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), poor, 1000)

    response = client.patch(
        f"/transactions/{created['id']}", headers=bot_headers(connection, poor), json={"status": "Refunded"}
    )

    assert response.json()["status"] == "Refunded"
    assert reserve_of(connection, poor) == Decimal("100000.00")
    assert reserve_of(connection, rich) == Decimal("1001000.00") - Decimal("999.99")


def test_only_the_target_bot_can_update(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    headers = bot_headers(connection, rich)
    created = send(client, headers, poor, 10)

    response = client.patch(f"/transactions/{created['id']}", headers=headers, json={"status": "Completed"})

    assert response.status_code == 403


def test_handled_transaction_cannot_change_again(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), poor, 10)
    headers = bot_headers(connection, poor)
    client.patch(f"/transactions/{created['id']}", headers=headers, json={"status": "Completed"})

    response = client.patch(f"/transactions/{created['id']}", headers=headers, json={"status": "Refunded"})

    assert (response.status_code, response.json()["field"]) == (400, "status")


@pytest.mark.parametrize("status", ["Pending", "Cancelled", "Reversed"])
def test_bot_can_only_set_completed_or_refunded(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], status: str
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), poor, 10)

    response = client.patch(
        f"/transactions/{created['id']}", headers=bot_headers(connection, poor), json={"status": status}
    )

    assert (response.status_code, response.json()["field"]) == (400, "status")


def test_concurrent_transactions_do_not_lose_updates(
    client: TestClient, database_url: str, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair

    def convert(user_number: int) -> None:
        with psycopg.connect(database_url, row_factory=dict_row) as db:
            user_id = f"5000000000000000{user_number:02d}"
            create_transaction(db, user_id, rich, poor, Decimal(1000), NOW)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(convert, range(16)))

    payouts = connection.execute("SELECT sum(payout) AS paid, sum(amount) AS sent FROM transactions").fetchone()

    assert reserve_of(connection, rich) == Decimal(1_000_000) + payouts["sent"]
    assert reserve_of(connection, poor) == Decimal(100_000) - payouts["paid"]
    assert connection.execute("SELECT count(*) AS created FROM transactions").fetchone()["created"] == 16
