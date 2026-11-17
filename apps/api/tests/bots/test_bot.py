from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app.bots.tokens import issue_api_token
from app.transactions.ledger import create_transaction
from tests.factories import (
    NOW,
    UNKNOWN_ID,
    USER_ID,
    bot_of,
    create_botless_currency,
    deactivate,
    remove_currency,
    reserve_of,
)

OTHER_USER_ID = "400000000000000004"


def bot_headers(connection: psycopg.Connection, currency_id: UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_api_token(connection, bot_of(connection, currency_id))}"}


def send(
    client: TestClient, headers: dict[str, str], sides: tuple[UUID, UUID], amount: float, user_id: str = USER_ID
) -> dict:
    source, target = sides
    response = client.post(
        "/transactions",
        headers=headers,
        json={"userId": user_id, "fromCurrencyId": str(source), "toCurrencyId": str(target), "amount": amount},
    )

    return {"http": response.status_code, **response.json()}


def pending_into(client: TestClient, headers: dict[str, str], currency_id: UUID) -> dict:
    response = client.get("/transactions/pending", headers=headers, params={"currencyId": str(currency_id)})

    return {"http": response.status_code, "body": response.json()}


def test_create_applies_the_curve_and_saves(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair

    created = send(client, bot_headers(connection, rich), pair, 1000)

    assert created["http"] == 201
    assert created["payout"] == 99.9
    assert created["userId"] == USER_ID
    assert created["status"] == "Pending" and created["handledAt"] is None
    assert created["fromCurrency"] == {"abbreviation": "RCH", "name": "RCH coin", "removed": False}
    assert created["toCurrency"] == {"abbreviation": "POR", "name": "POR coin", "removed": False}
    assert reserve_of(connection, rich) == Decimal("1001000.00")
    assert reserve_of(connection, poor) == Decimal("99900.10")
    history = connection.execute("SELECT count(*) AS points FROM currency_history").fetchone()
    assert history["points"] == 4


def test_create_needs_a_valid_token(client: TestClient, pair: tuple[UUID, UUID]) -> None:
    assert send(client, {}, pair, 10)["http"] == 401
    assert send(client, {"Authorization": "Bearer nope"}, pair, 10)["http"] == 401


def test_create_needs_the_source_currency(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair

    response = client.post(
        "/transactions",
        headers=bot_headers(connection, rich),
        json={"userId": USER_ID, "toCurrencyId": str(poor), "amount": 10},
    )

    assert (response.status_code, response.json()["field"]) == (400, "fromCurrencyId")


@pytest.mark.parametrize("state", ["unknown", "removed"])
@pytest.mark.parametrize(("side", "field"), [(0, "fromCurrencyId"), (1, "toCurrencyId")])
def test_create_rejects_a_currency_that_does_not_exist(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], side: int, field: str, state: str
) -> None:
    headers = bot_headers(connection, pair[0])
    sides = list(pair)

    if state == "unknown":
        sides[side] = UNKNOWN_ID
    else:
        remove_currency(connection, pair[side])

    response = send(client, headers, (sides[0], sides[1]), 10)

    assert (response["http"], response["field"]) == (404, field)


@pytest.mark.parametrize("owner", ["another bot", "no bot"])
def test_create_rejects_a_source_the_bot_does_not_run(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], owner: str
) -> None:
    rich, poor = pair
    source = rich if owner == "another bot" else create_botless_currency(connection, "PBL", 1_000_000)

    response = send(client, bot_headers(connection, poor), (source, poor), 10)

    assert (response["http"], response["field"]) == (403, "fromCurrencyId")
    assert reserve_of(connection, poor) == Decimal(100_000)


@pytest.mark.parametrize(
    ("currency", "status"), [("malformed", 400), ("unknown", 404), ("removed", 404), ("another bot's", 403)]
)
def test_pending_needs_one_of_the_bots_live_currencies(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], currency: str, status: int
) -> None:
    rich, poor = pair
    headers = bot_headers(connection, rich)
    params = {
        "malformed": {"currencyId": "nope"},
        "unknown": {"currencyId": UNKNOWN_ID},
        "removed": {"currencyId": str(rich)},
        "another bot's": {"currencyId": str(poor)},
    }[currency]

    if currency == "removed":
        remove_currency(connection, rich)

    response = client.get("/transactions/pending", headers=headers, params=params)

    assert (response.status_code, response.json()["field"]) == (status, "currencyId")


def test_a_bot_with_several_currencies_uses_each_of_them(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    gems = create_botless_currency(connection, "GEM", 1_000_000)
    connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (bot_of(connection, rich), gems))
    headers = bot_headers(connection, rich)

    from_rich = send(client, headers, (rich, poor), 10)
    from_gems = send(client, headers, (gems, poor), 10)
    into_rich = send(client, bot_headers(connection, poor), (poor, rich), 10)
    into_gems = send(client, bot_headers(connection, poor), (poor, gems), 10)

    assert (from_rich["fromCurrencyId"], from_gems["fromCurrencyId"]) == (str(rich), str(gems))
    assert [row["id"] for row in pending_into(client, headers, rich)["body"]] == [into_rich["id"]]
    assert [row["id"] for row in pending_into(client, headers, gems)["body"]] == [into_gems["id"]]
    every_currency = client.get("/transactions/pending", headers=headers).json()
    assert sorted(row["id"] for row in every_currency) == sorted([into_rich["id"], into_gems["id"]])
    completed = client.patch(f"/transactions/{into_gems['id']}", headers=headers, json={"status": "Completed"})
    assert completed.json()["status"] == "Completed"


def test_regenerated_token_replaces_the_old_one(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, _ = pair
    old = bot_headers(connection, rich)
    new = bot_headers(connection, rich)

    assert send(client, old, pair, 10)["http"] == 401
    assert send(client, new, pair, 10)["http"] == 201


def test_token_is_stored_as_a_hash_only(client: TestClient, connection: psycopg.Connection, pair: tuple) -> None:
    rich, _ = pair
    token = issue_api_token(connection, bot_of(connection, rich))

    assert token not in str(connection.execute("SELECT * FROM bots").fetchall())


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
        "/transactions",
        headers=bot_headers(connection, rich),
        json={"fromCurrencyId": str(rich), "toCurrencyId": str(poor), **body},
    )

    assert response.status_code == 400
    assert response.json()["field"] == field
    assert reserve_of(connection, rich) == Decimal(1_000_000)


def test_create_rejects_converting_into_itself(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, _ = pair

    assert send(client, bot_headers(connection, rich), (rich, rich), 10)["field"] == "toCurrencyId"


@pytest.mark.parametrize(("side", "field"), [("source", "fromCurrencyId"), ("target", "toCurrencyId")])
def test_create_rejects_an_inactive_currency(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], side: str, field: str
) -> None:
    rich, poor = pair
    deactivate(connection, rich if side == "source" else poor)

    response = send(client, bot_headers(connection, rich), pair, 10)

    assert (response["http"], response["field"]) == (400, field)


@pytest.mark.parametrize(
    ("bot_of_currency", "currency", "target"),
    [
        (None, None, "POR"),
        (None, "RCH", "POR"),
        (None, "POR", "POR"),
        ("RCH", None, "POR"),
        ("POR", None, "POR"),
        ("POR", None, "GEM"),
    ],
    ids=["global", "source currency", "target currency", "source bot", "target bot", "other currency of the bot"],
)
def test_create_rejects_a_blocked_user(
    client: TestClient,
    connection: psycopg.Connection,
    pair: tuple[UUID, UUID],
    bot_of_currency: str | None,
    currency: str | None,
    target: str,
) -> None:
    rich, poor = pair
    gems = create_botless_currency(connection, "GEM", 1_000_000)
    connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (bot_of(connection, poor), gems))
    currencies = {"RCH": rich, "POR": poor, "GEM": gems}
    blocked_bot = None if bot_of_currency is None else bot_of(connection, currencies[bot_of_currency])
    blocked_currency = None if currency is None else currencies[currency]
    connection.execute(
        """
        INSERT INTO blocks (user_id, bot_id, currency_id, reason, blocked_by, blocked_at)
        VALUES (%s, %s, %s, 'spam', %s, %s)
        """,
        (USER_ID, blocked_bot, blocked_currency, USER_ID, NOW),
    )

    response = send(client, bot_headers(connection, rich), (rich, currencies[target]), 10)

    assert (response["http"], response["field"]) == (403, "userId")


def test_unblocked_user_can_convert_again(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, _ = pair
    connection.execute(
        """
        INSERT INTO blocks (user_id, reason, blocked_by, blocked_at, unblocked_by, unblocked_at)
        VALUES (%s, 'spam', %s, %s, %s, %s)
        """,
        (USER_ID, USER_ID, NOW, USER_ID, NOW),
    )

    assert send(client, bot_headers(connection, rich), pair, 10)["http"] == 201


def test_daily_cap_rejects_with_the_most_the_user_can_send(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connection.execute("UPDATE currencies SET daily_cap = 50 WHERE id = %s", (poor,))
    headers = bot_headers(connection, rich)

    rejected = send(client, headers, pair, 1000)

    assert rejected["http"] == 400
    assert rejected["field"] == "amount"
    assert rejected["maxAmount"] == 500.25
    assert send(client, headers, pair, 500.25)["http"] == 201
    assert send(client, headers, pair, 20)["maxAmount"] == 0.1


def test_daily_cap_counts_only_this_user_in_the_last_day(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connection.execute("UPDATE currencies SET daily_cap = 50 WHERE id = %s", (poor,))
    headers = bot_headers(connection, rich)
    send(client, headers, pair, 500)

    assert send(client, headers, pair, 500, user_id=OTHER_USER_ID)["http"] == 201
    assert send(client, headers, pair, 20)["http"] == 400


def test_daily_cap_ignores_refunded_transactions(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    connection.execute("UPDATE currencies SET daily_cap = 50 WHERE id = %s", (poor,))
    created = send(client, bot_headers(connection, rich), pair, 500)
    client.patch(f"/transactions/{created['id']}", headers=bot_headers(connection, poor), json={"status": "Refunded"})

    assert send(client, bot_headers(connection, rich), pair, 500)["http"] == 201


def test_pending_lists_incoming_transactions_for_the_currency(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), pair, 10)

    incoming = pending_into(client, bot_headers(connection, poor), poor)["body"]
    outgoing = pending_into(client, bot_headers(connection, rich), rich)["body"]

    assert [transaction["id"] for transaction in incoming] == [created["id"]]
    assert incoming[0]["userId"] == USER_ID
    assert outgoing == []


def test_target_bot_completes_a_transaction(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), pair, 10)

    response = client.patch(
        f"/transactions/{created['id']}", headers=bot_headers(connection, poor), json={"status": "Completed"}
    )

    assert response.json()["status"] == "Completed"
    assert response.json()["handledAt"] == "2026-11-13T12:00:00Z"


def test_refund_runs_the_payout_back_through_the_curve(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), pair, 1000)

    response = client.patch(
        f"/transactions/{created['id']}", headers=bot_headers(connection, poor), json={"status": "Refunded"}
    )

    assert response.json()["status"] == "Refunded"
    assert reserve_of(connection, poor) == Decimal("100000.00")
    assert reserve_of(connection, rich) == Decimal("1001000.00") - Decimal("999.99")


def test_only_the_target_bot_can_update(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, _ = pair
    headers = bot_headers(connection, rich)
    created = send(client, headers, pair, 10)

    response = client.patch(f"/transactions/{created['id']}", headers=headers, json={"status": "Completed"})

    assert response.status_code == 403


def test_updating_an_unknown_transaction_is_404(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, _ = pair

    response = client.patch(
        f"/transactions/{UNKNOWN_ID}", headers=bot_headers(connection, rich), json={"status": "Completed"}
    )

    assert response.status_code == 404


def test_handled_transaction_cannot_change_again(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID]
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), pair, 10)
    headers = bot_headers(connection, poor)
    client.patch(f"/transactions/{created['id']}", headers=headers, json={"status": "Completed"})

    response = client.patch(f"/transactions/{created['id']}", headers=headers, json={"status": "Refunded"})

    assert (response.status_code, response.json()["field"]) == (400, "status")


@pytest.mark.parametrize("status", ["Pending", "Cancelled", "Reversed"])
def test_bot_can_only_set_completed_or_refunded(
    client: TestClient, connection: psycopg.Connection, pair: tuple[UUID, UUID], status: str
) -> None:
    rich, poor = pair
    created = send(client, bot_headers(connection, rich), pair, 10)

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
