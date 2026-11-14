from datetime import timedelta
from decimal import Decimal
from uuid import UUID

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

import app.admin.deactivation
from app.transactions.ledger import create_transaction
from tests.factories import FIRST_ADMIN_ID, NOW, OWNER_ID, USER_ID, create_currency, log_in


@pytest.fixture
def trio(client: TestClient, connection: psycopg.Connection) -> tuple[UUID, UUID, UUID]:
    log_in(client, connection, FIRST_ADMIN_ID)

    return (
        create_currency(connection, "OAT", 1_000_000),
        create_currency(connection, "GEM", 1_000_000),
        create_currency(connection, "PBL", 1_000_000),
    )


def convert(connection: psycopg.Connection, source: UUID, target: UUID, hours_ago: int) -> UUID:
    return create_transaction(connection, USER_ID, source, target, Decimal(1000), NOW - timedelta(hours=hours_ago))[
        "id"
    ]


def status_of(connection: psycopg.Connection, transaction_id: UUID) -> str:
    return connection.execute("SELECT status FROM transactions WHERE id = %s", (transaction_id,)).fetchone()["status"]


def set_active(client: TestClient, currency_id: UUID, active: bool) -> httpx.Response:
    return client.patch(f"/admin/currencies/{currency_id}", json={"active": active})


def reserves(connection: psycopg.Connection) -> list[Decimal]:
    return [row["reserve"] for row in connection.execute("SELECT reserve FROM currencies ORDER BY id").fetchall()]


def test_deactivation_cancels_pending_both_ways(
    client: TestClient, connection: psycopg.Connection, trio: tuple[UUID, UUID, UUID]
) -> None:
    oats, gems, pebbles = trio
    into = convert(connection, gems, oats, 2)
    out_of = convert(connection, oats, pebbles, 1)
    elsewhere = convert(connection, gems, pebbles, 1)

    response = set_active(client, oats, False)

    assert response.status_code == 200
    assert response.json()["currency"]["active"] is False
    assert (status_of(connection, into), status_of(connection, out_of)) == ("Cancelled", "Cancelled")
    assert status_of(connection, elsewhere) == "Pending"


def test_deactivation_sends_cancelled_webhooks(
    client: TestClient, connection: psycopg.Connection, trio: tuple[UUID, UUID, UUID]
) -> None:
    oats, gems, _ = trio
    connection.execute(
        "UPDATE currencies SET webhook_url = 'https://bot.example.com', webhook_secret_sealed = 'v1.unused'"
    )
    convert(connection, oats, gems, 1)
    connection.execute("DELETE FROM webhook_deliveries")

    set_active(client, oats, False)

    deliveries = connection.execute("SELECT event, currency_id FROM webhook_deliveries").fetchall()
    assert deliveries == [{"event": "cancelled", "currency_id": gems}]


def test_inactive_currency_is_hidden_and_rejects_new_transactions(
    client: TestClient, connection: psycopg.Connection, trio: tuple[UUID, UUID, UUID]
) -> None:
    oats, gems, _ = trio
    set_active(client, oats, False)

    listed = [currency["abbreviation"] for currency in client.get("/currencies").json()]
    quote = client.get("/quote", params={"fromCurrencyId": str(gems), "toCurrencyId": str(oats), "amount": "10"})

    assert listed == ["GEM", "PBL"]
    assert client.get("/currencies/OAT").json()["active"] is False
    assert client.get(f"/currencies/{oats}/history", params={"days": 7}).status_code == 200
    assert (quote.status_code, quote.json()["field"]) == (400, "toCurrencyId")


def test_reactivation_does_not_restore_cancelled_transactions(
    client: TestClient, connection: psycopg.Connection, trio: tuple[UUID, UUID, UUID]
) -> None:
    oats, gems, _ = trio
    cancelled = convert(connection, gems, oats, 1)
    set_active(client, oats, False)

    response = set_active(client, oats, True)

    assert response.json()["currency"]["active"] is True
    assert status_of(connection, cancelled) == "Cancelled"
    assert [currency["abbreviation"] for currency in client.get("/currencies").json()] == ["GEM", "OAT", "PBL"]


def test_deactivation_is_all_or_nothing(
    client: TestClient,
    connection: psycopg.Connection,
    trio: tuple[UUID, UUID, UUID],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    oats, gems, pebbles = trio
    first = convert(connection, gems, oats, 2)
    second = convert(connection, pebbles, oats, 1)
    before = reserves(connection)
    real_undo = app.admin.deactivation.undo_transaction
    calls = []

    def fail_second_undo(*arguments: object) -> dict:
        calls.append(arguments)
        if len(calls) == 2:
            raise RuntimeError("undo failed")

        return real_undo(*arguments)

    monkeypatch.setattr(app.admin.deactivation, "undo_transaction", fail_second_undo)

    with pytest.raises(RuntimeError, match="undo failed"):
        set_active(client, oats, False)

    assert (status_of(connection, first), status_of(connection, second)) == ("Pending", "Pending")
    assert reserves(connection) == before
    assert connection.execute("SELECT active FROM currencies WHERE id = %s", (oats,)).fetchone()["active"] is True


def test_refunds_still_work_on_an_inactive_currency(
    client: TestClient, connection: psycopg.Connection, trio: tuple[UUID, UUID, UUID]
) -> None:
    _, gems, pebbles = trio
    connection.execute("UPDATE currencies SET active = false WHERE id = %s", (pebbles,))
    connection.execute(
        """
        INSERT INTO transactions (id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at)
        VALUES ('019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21', %s, %s, %s, 1000, 999, 'Pending', %s)
        """,
        (USER_ID, gems, pebbles, NOW),
    )
    log_in(client, connection, OWNER_ID)
    token = client.post(f"/currencies/{pebbles}/api-token").json()["token"]

    response = client.patch(
        "/transactions/019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21",
        headers={"Authorization": f"Bearer {token}"},
        json={"status": "Refunded"},
    )

    assert response.json()["status"] == "Refunded"


@pytest.mark.parametrize("action", ["deactivate", "reactivate"])
def test_status_only_changes_through_the_admin_edit(
    client: TestClient, trio: tuple[UUID, UUID, UUID], action: str
) -> None:
    oats, _, _ = trio

    assert client.post(f"/admin/currencies/{oats}/{action}").status_code == 404
