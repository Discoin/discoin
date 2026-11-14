from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.transactions.ledger import create_transaction as create_ledger_transaction
from tests.factories import FIRST_ADMIN_ID, NOW, OWNER_ID, USER_ID, create_currency, deactivate, log_in

NEW_CURRENCY = {"name": "Oats", "abbreviation": "oat", "weeklyMedian": 25_000, "ownerId": OWNER_ID}


@pytest.fixture
def as_admin(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, FIRST_ADMIN_ID)


def test_admin_adds_a_currency_with_a_starting_reserve(client: TestClient, as_admin: None) -> None:
    response = client.post("/admin/currencies", json=NEW_CURRENCY)

    added = response.json()
    assert response.status_code == 201
    assert added["weeklyMedian"] == 25_000
    assert added["ownerId"] == OWNER_ID
    assert added["currency"]["abbreviation"] == "OAT"
    assert added["currency"]["reserve"] == 100_000
    assert added["currency"]["valueHistory"] == [1.0]
    assert client.get("/currencies/OAT").status_code == 200


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
        ({"ownerId": "42"}, "ownerId"),
    ],
)
def test_add_checks_every_field(
    client: TestClient, connection: psycopg.Connection, as_admin: None, changes: dict, field: str
) -> None:
    response = client.post("/admin/currencies", json={**NEW_CURRENCY, **changes})

    assert (response.status_code, response.json()["field"]) == (400, field)
    assert connection.execute("SELECT count(*) AS currencies FROM currencies").fetchone()["currencies"] == 0


def test_add_stores_the_code_in_capitals_and_finds_it_in_any_case(client: TestClient, as_admin: None) -> None:
    client.post("/admin/currencies", json={**NEW_CURRENCY, "abbreviation": "pBlz"})

    assert client.get("/currencies/pblz").json()["abbreviation"] == "PBLZ"


def test_add_rejects_a_taken_abbreviation(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    create_currency(connection, "OAT", 100_000)

    response = client.post("/admin/currencies", json=NEW_CURRENCY)

    assert (response.status_code, response.json()["field"]) == (409, "abbreviation")


def test_admin_lists_every_currency_with_median_and_owner(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    hidden = create_currency(connection, "OFF", 100_000)
    deactivate(connection, hidden)
    create_currency(connection, "OAT", 100_000)

    listed = client.get("/admin/currencies").json()

    assert [(row["currency"]["abbreviation"], row["weeklyMedian"], row["ownerId"]) for row in listed] == [
        ("OAT", 25_000, OWNER_ID),
        ("OFF", 25_000, OWNER_ID),
    ]


def test_new_median_resets_the_reserve(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    response = client.patch(f"/admin/currencies/{currency_id}", json={"weeklyMedian": 50_000})

    assert response.json()["currency"]["reserve"] == 200_000
    assert response.json()["weeklyMedian"] == 50_000
    assert response.json()["ownerId"] == OWNER_ID
    history = client.get(f"/currencies/{currency_id}/history", params={"days": 7}).json()
    assert history[-1] == {"at": "2026-11-13T12:00:00Z", "reserve": 200_000.0}


def test_new_owner_keeps_the_reserve(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    currency_id = create_currency(connection, "OAT", 123_456)

    response = client.patch(f"/admin/currencies/{currency_id}", json={"ownerId": USER_ID})

    assert (response.json()["ownerId"], response.json()["currency"]["reserve"]) == (USER_ID, 123_456)


def test_edit_saves_nothing_when_one_field_is_bad(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    response = client.patch(f"/admin/currencies/{currency_id}", json={"ownerId": USER_ID, "weeklyMedian": -1})

    stored = connection.execute("SELECT owner_id, reserve FROM currencies").fetchone()
    assert (response.status_code, response.json()["field"]) == (400, "weeklyMedian")
    assert stored == {"owner_id": OWNER_ID, "reserve": 100_000}


def test_edit_needs_a_change(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    assert client.patch(f"/admin/currencies/{currency_id}", json={}).status_code == 400


def test_edit_works_on_an_inactive_currency(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    deactivate(connection, currency_id)

    assert client.patch(f"/admin/currencies/{currency_id}", json={"weeklyMedian": 10}).status_code == 200


def test_edit_unknown_currency_is_404(client: TestClient, as_admin: None) -> None:
    response = client.patch("/admin/currencies/019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21", json={"weeklyMedian": 10})

    assert response.status_code == 404


def test_admin_grants_and_removes_admins(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    granted = client.post("/admin/admins", json={"userId": USER_ID})
    listed = client.get("/admin/admins").json()
    removed = client.delete(f"/admin/admins/{USER_ID}")

    assert granted.status_code == 201
    assert granted.json() == {"userId": USER_ID, "username": None}
    assert [admin["userId"] for admin in listed] == [FIRST_ADMIN_ID, USER_ID]
    assert removed.status_code == 204
    assert [admin["userId"] for admin in client.get("/admin/admins").json()] == [FIRST_ADMIN_ID]


def test_granting_an_admin_twice_is_a_conflict(client: TestClient, as_admin: None) -> None:
    client.post("/admin/admins", json={"userId": USER_ID})

    response = client.post("/admin/admins", json={"userId": USER_ID})

    assert (response.status_code, response.json()["field"]) == (409, "userId")


def test_granting_keeps_a_known_username(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    connection.execute("INSERT INTO users (id, username) VALUES (%s, 'trader')", (USER_ID,))

    assert client.post("/admin/admins", json={"userId": USER_ID}).json()["username"] == "trader"


def test_admin_cannot_remove_themselves(client: TestClient, as_admin: None) -> None:
    assert client.delete(f"/admin/admins/{FIRST_ADMIN_ID}").status_code == 400


def test_removing_a_non_admin_is_404(client: TestClient, as_admin: None) -> None:
    assert client.delete(f"/admin/admins/{USER_ID}").status_code == 404


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/admin/currencies"),
        ("POST", "/admin/currencies"),
        ("PATCH", "/admin/currencies/019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21"),
        ("GET", "/admin/admins"),
        ("POST", "/admin/admins"),
        ("DELETE", f"/admin/admins/{USER_ID}"),
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


def test_history_point_is_recorded_when_added(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    added = client.post("/admin/currencies", json=NEW_CURRENCY).json()
    currency_id = UUID(added["currency"]["id"])

    points = connection.execute(
        "SELECT recorded_at FROM currency_history WHERE currency_id = %s", (currency_id,)
    ).fetchall()

    assert points == [{"recorded_at": NOW}]


def test_edit_can_deactivate_and_cancels_pending(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    pending = create_ledger_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)["id"]

    response = client.patch(f"/admin/currencies/{oats}", json={"active": False})

    status = connection.execute("SELECT status FROM transactions WHERE id = %s", (pending,)).fetchone()
    assert response.json()["currency"]["active"] is False
    assert status == {"status": "Cancelled"}


def test_edit_can_reactivate(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    deactivate(connection, currency_id)

    assert client.patch(f"/admin/currencies/{currency_id}", json={"active": True}).json()["currency"]["active"]


def test_edit_with_the_current_status_changes_nothing(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    response = client.patch(f"/admin/currencies/{currency_id}", json={"active": True})

    assert (response.status_code, response.json()["currency"]["active"]) == (200, True)


def test_status_and_owner_save_together_or_not_at_all(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    response = client.patch(f"/admin/currencies/{currency_id}", json={"active": False, "ownerId": "12"})

    stored = connection.execute("SELECT active, owner_id FROM currencies").fetchone()
    assert (response.status_code, response.json()["field"]) == (400, "ownerId")
    assert stored == {"active": True, "owner_id": OWNER_ID}
