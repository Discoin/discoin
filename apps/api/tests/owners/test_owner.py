from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.factories import FIRST_ADMIN_ID, OWNER_ID, USER_ID, create_currency, deactivate, log_in


@pytest.fixture
def owned(client: TestClient, connection: psycopg.Connection) -> UUID:
    currency_id = create_currency(connection, "OAT", 100_000)
    log_in(client, connection, OWNER_ID)

    return currency_id


def test_owner_lists_owned_currencies_including_inactive(
    client: TestClient, connection: psycopg.Connection, owned: UUID
) -> None:
    deactivate(connection, owned)

    assert [currency["id"] for currency in client.get("/owner/currencies").json()] == [str(owned)]


def test_settings_start_empty(client: TestClient, owned: UUID) -> None:
    assert client.get(f"/currencies/{owned}/settings").json() == {
        "hasApiToken": False,
        "hasWebhookSecret": False,
        "webhookUrl": None,
        "dailyCap": None,
    }


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/settings", None),
        ("PATCH", "", {"name": "Oats", "abbreviation": "OAT"}),
        ("POST", "/api-token", None),
        ("PUT", "/webhook-url", {"webhookUrl": "https://bot.example.com"}),
        ("DELETE", "/webhook-url", None),
        ("PUT", "/daily-cap", {"dailyCap": 10}),
        ("DELETE", "/daily-cap", None),
        ("GET", "/transactions/pending", None),
    ],
)
@pytest.mark.parametrize("user_id", [USER_ID, FIRST_ADMIN_ID])
def test_only_the_owner_can_use_owner_routes(
    client: TestClient, connection: psycopg.Connection, user_id: str, method: str, path: str, body: dict | None
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    log_in(client, connection, user_id)

    response = client.request(method, f"/currencies/{currency_id}{path}", json=body)

    assert response.status_code == 403


def test_owner_routes_need_a_login(client: TestClient, connection: psycopg.Connection) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    assert client.get(f"/currencies/{currency_id}/settings").status_code == 401


def test_owner_renames_the_currency(client: TestClient, owned: UUID) -> None:
    response = client.patch(f"/currencies/{owned}", json={"name": " Rolled Oats ", "abbreviation": "roat"})

    assert response.status_code == 200
    assert (response.json()["name"], response.json()["abbreviation"]) == ("Rolled Oats", "ROAT")
    assert client.get("/currencies/ROAT").status_code == 200


def test_owner_can_keep_the_same_abbreviation(client: TestClient, owned: UUID) -> None:
    assert client.patch(f"/currencies/{owned}", json={"name": "Oaty", "abbreviation": "OAT"}).status_code == 200


def test_rename_rejects_a_taken_abbreviation(client: TestClient, connection: psycopg.Connection, owned: UUID) -> None:
    create_currency(connection, "GEM", 100_000)

    response = client.patch(f"/currencies/{owned}", json={"name": "Oats", "abbreviation": "gem"})

    assert response.status_code == 409
    assert response.json()["field"] == "abbreviation"


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"name": "  ", "abbreviation": "OAT"}, "name"),
        ({"name": "Oats", "abbreviation": " "}, "abbreviation"),
        ({"name": "Oats", "abbreviation": "OA-T"}, "abbreviation"),
        ({"name": "Oats", "abbreviation": "OA"}, "abbreviation"),
        ({"name": "Oats", "abbreviation": "OATSS"}, "abbreviation"),
        ({"name": "Oats", "abbreviation": "OA1"}, "abbreviation"),
        ({"name": "Oats", "abbreviation": "ÖAT"}, "abbreviation"),
        ({"name": "Oats", "abbreviation": "O T"}, "abbreviation"),
    ],
)
def test_rename_rejects_bad_details(client: TestClient, owned: UUID, body: dict, field: str) -> None:
    response = client.patch(f"/currencies/{owned}", json=body)

    assert (response.status_code, response.json()["field"]) == (400, field)


def test_regenerated_token_works_once_and_is_hidden_after(client: TestClient, owned: UUID) -> None:
    token = client.post(f"/currencies/{owned}/api-token").json()["token"]

    pending = client.get("/transactions/pending", headers={"Authorization": f"Bearer {token}"})

    assert token.startswith("dsc_live_")
    assert pending.status_code == 200
    assert client.get(f"/currencies/{owned}/settings").json()["hasApiToken"] is True
    assert token not in client.get(f"/currencies/{owned}/settings").text


def test_webhook_url_needs_a_secret_first(client: TestClient, owned: UUID) -> None:
    response = client.put(f"/currencies/{owned}/webhook-url", json={"webhookUrl": "https://bot.example.com/hook"})

    assert (response.status_code, response.json()["field"]) == (400, "webhookUrl")


def test_owner_sets_and_removes_the_webhook_url(client: TestClient, owned: UUID) -> None:
    client.post(f"/currencies/{owned}/webhook-secret")

    set_response = client.put(f"/currencies/{owned}/webhook-url", json={"webhookUrl": " https://bot.example.com/hook "})
    after_set = client.get(f"/currencies/{owned}/settings").json()
    client.delete(f"/currencies/{owned}/webhook-url")
    after_remove = client.get(f"/currencies/{owned}/settings").json()

    assert set_response.status_code == 204
    assert after_set["webhookUrl"] == "https://bot.example.com/hook"
    assert after_set["hasWebhookSecret"] is True
    assert after_remove["webhookUrl"] is None


@pytest.mark.parametrize("url", ["http://bot.example.com/hook", "bot.example.com", "https://"])
def test_webhook_url_must_be_https(client: TestClient, owned: UUID, url: str) -> None:
    client.post(f"/currencies/{owned}/webhook-secret")

    response = client.put(f"/currencies/{owned}/webhook-url", json={"webhookUrl": url})

    assert (response.status_code, response.json()["field"]) == (400, "webhookUrl")


def test_owner_sets_and_removes_the_daily_cap(client: TestClient, owned: UUID) -> None:
    client.put(f"/currencies/{owned}/daily-cap", json={"dailyCap": 250.5})
    after_set = client.get(f"/currencies/{owned}/settings").json()["dailyCap"]
    client.delete(f"/currencies/{owned}/daily-cap")

    assert after_set == 250.5
    assert client.get(f"/currencies/{owned}/settings").json()["dailyCap"] is None


@pytest.mark.parametrize("cap", [0, -5, 1_000_000_001])
def test_daily_cap_must_be_in_range(client: TestClient, owned: UUID, cap: float) -> None:
    response = client.put(f"/currencies/{owned}/daily-cap", json={"dailyCap": cap})

    assert (response.status_code, response.json()["field"]) == (400, "dailyCap")


def test_unknown_currency_is_404(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, OWNER_ID)

    assert client.get("/currencies/019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21/settings").status_code == 404
