from decimal import Decimal
from uuid import UUID

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.transactions.ledger import create_transaction as create_ledger_transaction
from tests.factories import (
    ADMIN_ID,
    NOW,
    OWNER_ID,
    UNKNOWN_ID,
    USER_ID,
    bot_of,
    create_bot,
    create_botless_currency,
    create_currency,
    deactivate,
    log_in,
)

TOO_LARGE_MULTIPLIER = 10_000_000_000


@pytest.fixture
def bot_id(connection: psycopg.Connection) -> UUID:
    return create_bot(connection)


@pytest.fixture
def new_currency(bot_id: UUID) -> dict:
    return {"name": "Oats", "abbreviation": "oat", "weeklyMedian": 25_000, "multiplier": 10, "botId": str(bot_id)}


def count_currencies(connection: psycopg.Connection) -> int:
    return connection.execute("SELECT count(*) AS currencies FROM currencies").fetchone()["currencies"]


def count_history(connection: psycopg.Connection, currency_id: UUID) -> int:
    row = connection.execute(
        "SELECT count(*) AS points FROM currency_history WHERE currency_id = %s", (currency_id,)
    ).fetchone()

    return row["points"]


def test_admin_adds_a_currency_with_a_starting_reserve(
    client: TestClient, as_admin: None, new_currency: dict, bot_id: UUID
) -> None:
    response = client.post("/admin/currencies", json=new_currency)

    added = response.json()
    assert response.status_code == 201
    assert added["weeklyMedian"] == 25_000
    assert added["multiplier"] == 10
    assert added["bot"]["id"] == str(bot_id)
    assert added["currency"]["abbreviation"] == "OAT"
    assert added["currency"]["reserve"] == 250_000
    assert added["currency"]["valueHistory"] == [0.4]
    assert client.get("/currencies/OAT").status_code == 200


def test_add_floors_the_starting_reserve_to_cents(client: TestClient, as_admin: None, new_currency: dict) -> None:
    response = client.post("/admin/currencies", json={**new_currency, "weeklyMedian": 0.15, "multiplier": 0.15})

    assert (response.json()["multiplier"], response.json()["currency"]["reserve"]) == (0.15, 0.02)


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"name": " "}, "name"),
        ({"abbreviation": ""}, "abbreviation"),
        ({"abbreviation": "OA"}, "abbreviation"),
        ({"abbreviation": "OATSS"}, "abbreviation"),
        ({"abbreviation": "OA7"}, "abbreviation"),
        ({"weeklyMedian": 0}, "weeklyMedian"),
        ({"weeklyMedian": 1_000_000_001}, "weeklyMedian"),
        ({"multiplier": 0}, "multiplier"),
        ({"multiplier": -4}, "multiplier"),
        ({"multiplier": 1.234}, "multiplier"),
        ({"multiplier": TOO_LARGE_MULTIPLIER}, "multiplier"),
        ({"weeklyMedian": 0.01, "multiplier": 0.01}, "multiplier"),
        ({"botId": None}, "botId"),
    ],
)
def test_add_checks_every_field(
    client: TestClient, connection: psycopg.Connection, as_admin: None, new_currency: dict, changes: dict, field: str
) -> None:
    response = client.post("/admin/currencies", json={**new_currency, **changes})

    assert (response.status_code, response.json()["field"]) == (400, field)
    assert count_currencies(connection) == 0


@pytest.mark.parametrize("missing", ["multiplier", "botId"])
def test_add_needs_a_multiplier_and_a_bot(
    client: TestClient, connection: psycopg.Connection, as_admin: None, new_currency: dict, missing: str
) -> None:
    without = {key: value for key, value in new_currency.items() if key != missing}

    response = client.post("/admin/currencies", json=without)

    assert (response.status_code, response.json()["field"]) == (400, missing)
    assert count_currencies(connection) == 0


def test_add_refuses_an_unknown_bot(
    client: TestClient, connection: psycopg.Connection, as_admin: None, new_currency: dict
) -> None:
    response = client.post("/admin/currencies", json={**new_currency, "botId": UNKNOWN_ID})

    assert (response.status_code, response.json()["field"]) == (404, "botId")
    assert count_currencies(connection) == 0


def test_add_rejects_a_taken_abbreviation(
    client: TestClient, connection: psycopg.Connection, as_admin: None, new_currency: dict
) -> None:
    create_currency(connection, "OAT", 100_000)

    response = client.post("/admin/currencies", json=new_currency)

    assert (response.status_code, response.json()["field"]) == (409, "abbreviation")


def test_admin_lists_every_currency_with_median_and_bot(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    hidden = create_currency(connection, "OFF", 100_000)
    deactivate(connection, hidden)
    oats = create_currency(connection, "OAT", 100_000)

    listed = client.get("/admin/currencies").json()

    assert [
        (row["currency"]["abbreviation"], row["weeklyMedian"], row["multiplier"], row["bot"]["id"]) for row in listed
    ] == [
        ("OAT", 25_000, 4, str(bot_of(connection, oats))),
        ("OFF", 25_000, 4, str(bot_of(connection, hidden))),
    ]


@pytest.mark.parametrize(
    ("stored_multiplier", "changes", "median", "multiplier", "reserve"),
    [
        (4, {"weeklyMedian": 50_000}, 50_000, 4, 200_000),
        (10, {"weeklyMedian": 50_000}, 50_000, 10, 500_000),
        (4, {"multiplier": 10}, 25_000, 10, 250_000),
        (4, {"weeklyMedian": 30_000, "multiplier": 5}, 30_000, 5, 150_000),
    ],
)
def test_a_new_median_or_multiplier_resets_the_reserve_once(
    client: TestClient,
    connection: psycopg.Connection,
    as_admin: None,
    stored_multiplier: int,
    changes: dict,
    median: int,
    multiplier: int,
    reserve: int,
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    connection.execute("UPDATE currencies SET multiplier = %s WHERE id = %s", (stored_multiplier, currency_id))

    response = client.patch(f"/admin/currencies/{currency_id}", json=changes)

    entry = saved(response)
    history = client.get(f"/currencies/{currency_id}/history", params={"days": 7}).json()
    assert (entry["weeklyMedian"], entry["multiplier"], entry["currency"]["reserve"]) == (median, multiplier, reserve)
    assert entry["bot"]["id"] == str(bot_of(connection, currency_id))
    assert history[-1] == {"at": "2026-11-13T12:00:00Z", "reserve": float(reserve)}
    assert count_history(connection, currency_id) == 2


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"multiplier": 0}, "multiplier"),
        ({"multiplier": 1.234}, "multiplier"),
        ({"multiplier": TOO_LARGE_MULTIPLIER}, "multiplier"),
        ({"weeklyMedian": 0.01, "multiplier": 0.01}, "multiplier"),
        ({"weeklyMedian": 1_000_000_000, "multiplier": 1_000_000}, "multiplier"),
        ({"weeklyMedian": 50_000, "multiplier": None}, "multiplier"),
        ({"multiplier": None}, "multiplier"),
        ({"active": False, "weeklyMedian": None}, "weeklyMedian"),
    ],
)
def test_edit_refuses_a_bad_or_cleared_median_or_multiplier(
    client: TestClient, connection: psycopg.Connection, as_admin: None, changes: dict, field: str
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    response = client.patch(f"/admin/currencies/{currency_id}", json=changes)

    stored = connection.execute("SELECT active, reserve, weekly_median, multiplier FROM currencies").fetchone()
    assert (response.status_code, response.json()["field"]) == (400, field)
    assert stored == {"active": True, "reserve": 100_000, "weekly_median": 25_000, "multiplier": 4}


def test_edit_blames_the_median_when_only_the_median_breaks_the_reserve(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    connection.execute("UPDATE currencies SET multiplier = 1000000 WHERE id = %s", (currency_id,))

    response = client.patch(f"/admin/currencies/{currency_id}", json={"weeklyMedian": 1_000_000_000})

    assert (response.status_code, response.json()["field"]) == (400, "weeklyMedian")


def test_bad_multiplier_keeps_the_currency_active(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    pending = create_ledger_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)["id"]

    response = client.patch(f"/admin/currencies/{oats}", json={"active": False, "multiplier": 0.001})

    stored = connection.execute("SELECT active, multiplier FROM currencies WHERE id = %s", (oats,)).fetchone()
    status = connection.execute("SELECT status FROM transactions WHERE id = %s", (pending,)).fetchone()
    assert (response.status_code, response.json()["field"]) == (400, "multiplier")
    assert stored == {"active": True, "multiplier": 4}
    assert status == {"status": "Pending"}


def test_deactivating_with_a_new_multiplier_resets_the_reserve_last(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    pending = create_ledger_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)["id"]

    response = client.patch(f"/admin/currencies/{oats}", json={"active": False, "multiplier": 10})

    status = connection.execute("SELECT status FROM transactions WHERE id = %s", (pending,)).fetchone()
    assert status == {"status": "Cancelled"}
    assert saved(response)["currency"]["reserve"] == 2_500_000


def test_edit_saves_nothing_when_one_field_is_bad(
    client: TestClient, connection: psycopg.Connection, as_admin: None, bot_id: UUID
) -> None:
    currency_id = create_botless_currency(connection, "OAT", 100_000)

    response = client.patch(f"/admin/currencies/{currency_id}", json={"botId": str(bot_id), "weeklyMedian": -1})

    stored = connection.execute("SELECT bot_id, reserve FROM currencies").fetchone()
    assert (response.status_code, response.json()["field"]) == (400, "weeklyMedian")
    assert stored == {"bot_id": None, "reserve": 100_000}


def test_edit_needs_a_change(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    assert client.patch(f"/admin/currencies/{currency_id}", json={}).status_code == 400


def test_edit_works_on_an_inactive_currency(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    deactivate(connection, currency_id)

    assert client.patch(f"/admin/currencies/{currency_id}", json={"weeklyMedian": 10}).status_code == 200


def test_edit_unknown_currency_is_404(client: TestClient, as_admin: None) -> None:
    response = client.patch(f"/admin/currencies/{UNKNOWN_ID}", json={"weeklyMedian": 10})

    assert response.status_code == 404


def test_admin_grants_and_removes_admins(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    granted = client.post("/admin/admins", json={"userId": USER_ID})
    listed = client.get("/admin/admins").json()
    removed = client.delete(f"/admin/admins/{USER_ID}")

    assert granted.status_code == 201
    assert granted.json() == {"userId": USER_ID, "username": None}
    assert [admin["userId"] for admin in listed] == [ADMIN_ID, USER_ID]
    assert removed.status_code == 204
    assert [admin["userId"] for admin in client.get("/admin/admins").json()] == [ADMIN_ID]


def test_granting_an_admin_twice_is_a_conflict(client: TestClient, as_admin: None) -> None:
    client.post("/admin/admins", json={"userId": USER_ID})

    response = client.post("/admin/admins", json={"userId": USER_ID})

    assert (response.status_code, response.json()["field"]) == (409, "userId")


def test_granting_keeps_a_known_username(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    connection.execute("INSERT INTO users (id, username) VALUES (%s, 'trader')", (USER_ID,))

    assert client.post("/admin/admins", json={"userId": USER_ID}).json()["username"] == "trader"


def test_admin_cannot_remove_themselves(client: TestClient, as_admin: None) -> None:
    assert client.delete(f"/admin/admins/{ADMIN_ID}").status_code == 400


def test_removing_a_non_admin_is_404(client: TestClient, as_admin: None) -> None:
    assert client.delete(f"/admin/admins/{USER_ID}").status_code == 404


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/admin/currencies"),
        ("DELETE", f"/admin/currencies/{UNKNOWN_ID}"),
        ("PATCH", f"/admin/bots/{UNKNOWN_ID}"),
        ("POST", "/admin/admins"),
        ("POST", "/admin/blocks"),
    ],
)
def test_admin_routes_are_for_admins(
    client: TestClient, connection: psycopg.Connection, method: str, path: str
) -> None:
    log_in(client, connection, OWNER_ID)

    assert client.request(method, path, json={}).status_code == 403


def test_removed_admin_loses_access(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    client.post("/admin/admins", json={"userId": USER_ID})
    client.delete(f"/admin/admins/{USER_ID}")
    log_in(client, connection, USER_ID)

    assert client.get("/admin/admins").status_code == 403


@pytest.mark.parametrize("inactive_first", [True, False], ids=["reactivate", "already active"])
def test_edit_can_set_a_currency_active(
    client: TestClient, connection: psycopg.Connection, as_admin: None, inactive_first: bool
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    if inactive_first:
        deactivate(connection, currency_id)

    response = client.patch(f"/admin/currencies/{currency_id}", json={"active": True})

    assert (response.status_code, saved(response)["currency"]["active"]) == (200, True)


def test_status_and_bot_save_together_or_not_at_all(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    currency_id = create_botless_currency(connection, "OAT", 100_000)

    response = client.patch(
        f"/admin/currencies/{currency_id}",
        json={"active": False, "botId": UNKNOWN_ID},
    )

    stored = connection.execute("SELECT active, bot_id FROM currencies").fetchone()
    assert (response.status_code, response.json()["field"]) == (404, "botId")
    assert stored == {"active": True, "bot_id": None}


def saved(response: httpx.Response) -> dict:
    return response.json()["saved"]
