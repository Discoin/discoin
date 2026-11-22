from datetime import timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.factories import NOW, create_currency, create_transaction, deactivate


def test_currency_list_never_shows_inactive_currencies(client: TestClient, connection: psycopg.Connection) -> None:
    create_currency(connection, "OAT", 100_000)
    deactivate(connection, create_currency(connection, "OFF", 100_000))

    plain = client.get("/currencies").json()
    asked = client.get("/currencies", params={"includeInactive": "true"}).json()

    assert [currency["abbreviation"] for currency in plain] == ["OAT"]
    assert [currency["abbreviation"] for currency in asked] == ["OAT"]


def test_inactive_currency_lookup_is_not_found(client: TestClient, connection: psycopg.Connection) -> None:
    deactivate(connection, create_currency(connection, "OFF", 100_000))

    assert client.get("/currencies/off").status_code == 404


def test_inactive_currency_history_is_not_found(client: TestClient, connection: psycopg.Connection) -> None:
    currency_id = create_currency(connection, "OFF", 100_000)
    deactivate(connection, currency_id)

    assert client.get(f"/currencies/{currency_id}/history", params={"days": 7}).status_code == 404


def test_inactive_currency_transactions_are_not_found(client: TestClient, connection: psycopg.Connection) -> None:
    currency_id = create_currency(connection, "OFF", 100_000)
    deactivate(connection, currency_id)

    assert client.get(f"/currencies/{currency_id}/transactions").status_code == 404


def test_currency_shape_matches_the_frontend(client: TestClient, connection: psycopg.Connection) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    currency = client.get("/currencies/oat").json()

    assert currency == {
        "id": str(currency_id),
        "abbreviation": "OAT",
        "name": "OAT coin",
        "reserve": 100_000.0,
        "active": True,
        "change24h": 0.0,
        "valueHistory": [1.0] * 8,
    }


def test_change_and_sparkline_follow_history(client: TestClient, connection: psycopg.Connection) -> None:
    create_currency(
        connection,
        "OAT",
        50_000,
        history=[
            (NOW - timedelta(days=3), 100_000),
            (NOW - timedelta(hours=30), 80_000),
            (NOW - timedelta(hours=2), 50_000),
        ],
    )

    currency = client.get("/currencies/OAT").json()

    assert currency["change24h"] == pytest.approx(80_000 / 50_000 - 1)
    assert currency["valueHistory"] == [1.0, 1.0, 1.25, 2.0]


def test_new_currency_change_is_measured_from_creation(client: TestClient, connection: psycopg.Connection) -> None:
    create_currency(
        connection,
        "NEW",
        80_000,
        history=[(NOW - timedelta(hours=3), 100_000), (NOW - timedelta(hours=1), 80_000)],
    )

    assert client.get("/currencies/NEW").json()["change24h"] == pytest.approx(0.25)


def test_unknown_abbreviation_is_404(client: TestClient) -> None:
    response = client.get("/currencies/nope")

    assert response.status_code == 404
    assert response.json() == {"status": 404, "message": "No currency called NOPE.", "field": None}


def test_history_covers_the_window_from_its_start(client: TestClient, connection: psycopg.Connection) -> None:
    currency_id = create_currency(
        connection,
        "OAT",
        70_000,
        history=[
            (NOW - timedelta(days=40), 100_000),
            (NOW - timedelta(days=10), 90_000),
            (NOW - timedelta(days=2), 70_000),
        ],
    )

    week = client.get(f"/currencies/{currency_id}/history", params={"days": 7}).json()

    assert week == [
        {"at": (NOW - timedelta(days=7)).isoformat().replace("+00:00", "Z"), "reserve": 90_000.0},
        {"at": (NOW - timedelta(days=2)).isoformat().replace("+00:00", "Z"), "reserve": 70_000.0},
    ]
    assert len(client.get(f"/currencies/{currency_id}/history", params={"days": 30}).json()) == 3


@pytest.mark.parametrize("params", [{"days": 3}, {}], ids=["other window", "missing"])
def test_history_needs_a_supported_window(client: TestClient, connection: psycopg.Connection, params: dict) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    response = client.get(f"/currencies/{currency_id}/history", params=params)

    assert (response.status_code, response.json()["field"]) == (400, "days")


def test_recent_feed_is_newest_first(client: TestClient, connection: psycopg.Connection) -> None:
    oats = create_currency(connection, "OAT", 100_000)
    gems = create_currency(connection, "GEM", 100_000)
    older = create_transaction(connection, oats, gems, NOW - timedelta(hours=2))
    newer = create_transaction(connection, gems, oats, NOW - timedelta(hours=1), status="Pending")

    feed = client.get("/transactions").json()

    assert [transaction["id"] for transaction in feed] == [str(newer), str(older)]


def test_currency_trades_include_both_directions(client: TestClient, connection: psycopg.Connection) -> None:
    oats = create_currency(connection, "OAT", 100_000)
    gems = create_currency(connection, "GEM", 100_000)
    pebbles = create_currency(connection, "PBL", 100_000)
    outgoing = create_transaction(connection, oats, gems, NOW - timedelta(hours=3))
    incoming = create_transaction(connection, pebbles, oats, NOW - timedelta(hours=2))
    create_transaction(connection, gems, pebbles, NOW - timedelta(hours=1))

    trades = client.get(f"/currencies/{oats}/transactions").json()

    assert [trade["id"] for trade in trades] == [str(incoming), str(outgoing)]


def test_trades_for_unknown_currency_are_404(client: TestClient) -> None:
    response = client.get("/currencies/019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21/transactions")

    assert response.status_code == 404


def quote(client: TestClient, source: object, target: object, amount: str) -> dict:
    response = client.get("/quote", params={"fromCurrencyId": source, "toCurrencyId": target, "amount": amount})

    return {"status": response.status_code, **response.json()}


def test_quote_uses_the_curve(client: TestClient, connection: psycopg.Connection) -> None:
    rich = create_currency(connection, "RCH", 1_000_000)
    poor = create_currency(connection, "POR", 100_000)

    assert quote(client, rich, poor, "1000") == {"status": 200, "payout": 99.9}


@pytest.mark.parametrize(
    ("amount", "message"),
    [
        ("0", "The amount must be above 0."),
        ("1000000000.01", "The amount can be at most 1,000,000,000."),
        ("1.001", "The amount can have at most 2 decimals."),
        ("0.01", "This amount is too small to convert. Send more."),
    ],
)
def test_quote_rejects_bad_amounts(
    client: TestClient, connection: psycopg.Connection, amount: str, message: str
) -> None:
    rich = create_currency(connection, "RCH", 1_000_000)
    poor = create_currency(connection, "POR", 100_000)

    assert quote(client, rich, poor, amount) == {"status": 400, "message": message, "field": "amount"}


def test_quote_rejects_converting_into_itself(client: TestClient, connection: psycopg.Connection) -> None:
    oats = create_currency(connection, "OAT", 100_000)

    assert quote(client, oats, oats, "10")["field"] == "toCurrencyId"


def test_quote_rejects_inactive_currency(client: TestClient, connection: psycopg.Connection) -> None:
    oats = create_currency(connection, "OAT", 100_000)
    off = create_currency(connection, "OFF", 100_000)
    deactivate(connection, off)

    assert quote(client, off, oats, "10") == {
        "status": 400,
        "message": "OFF is inactive, so it can't be converted right now.",
        "field": "fromCurrencyId",
    }


def test_quote_needs_every_parameter(client: TestClient) -> None:
    response = client.get("/quote", params={"amount": "10"})

    assert response.status_code == 400
    assert response.json()["field"] == "fromCurrencyId"
