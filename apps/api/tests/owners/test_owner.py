from datetime import timedelta
from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from httpx import Response
from psycopg.rows import dict_row

import app.owners.access
import app.owners.routes
from app.auth.sessions import SESSION_COOKIE
from app.core.errors import ApiError
from app.owners.access import BotOwnership, Ownership, lock_owned_bot, require_owner
from tests.factories import (
    FIRST_ADMIN_ID,
    LOCK_TIMEOUT_MS,
    NOW,
    OWNER_ID,
    USER_ID,
    bot_of,
    create_botless_currency,
    create_currency,
    deactivate,
    log_in,
)
from tests.factories import create_transaction as insert_transaction

UNKNOWN_ID = "019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21"
STORED_CAP = Decimal("50.00")
INACTIVE_REFUSAL = (
    400,
    "OAT is inactive, so its settings can't be changed until a Discoin admin reactivates it.",
    "currencyId",
)
PREVIEW = {"userId": USER_ID, "reason": "Spam", "reverse": {"window": "all", "direction": "both"}}
CURRENCY_WRITES = [
    ("PATCH", "", {"name": "Oats", "abbreviation": "OAT"}),
    ("PUT", "/daily-cap", {"dailyCap": 10}),
    ("DELETE", "/daily-cap", None),
]
CURRENCY_ROUTES = [("GET", "/settings", None), *CURRENCY_WRITES]
BOT_WRITES = [
    ("POST", "/api-token", None),
    ("POST", "/webhook-secret", None),
    ("PUT", "/webhook-url", {"webhookUrl": "https://bot.example.com"}),
    ("DELETE", "/webhook-url", None),
    ("POST", "/blocks", {"userId": USER_ID, "reason": "Spam"}),
    ("DELETE", f"/blocks/{USER_ID}", None),
]
BOT_ROUTES = [
    ("GET", "/settings", None),
    ("POST", "/webhook-test", None),
    ("GET", "/transactions/pending", None),
    ("GET", "/blocks", None),
    ("POST", "/blocks/preview", PREVIEW),
    *BOT_WRITES,
]


@pytest.fixture
def owned(client: TestClient, connection: psycopg.Connection) -> UUID:
    currency_id = create_currency(connection, "OAT", 100_000)
    log_in(client, connection, OWNER_ID)

    return currency_id


@pytest.fixture
def owned_bot(connection: psycopg.Connection, owned: UUID) -> UUID:
    return bot_of(connection, owned)


def named_bot(connection: psycopg.Connection, currency_id: UUID, name: str) -> UUID:
    bot_id = bot_of(connection, currency_id)
    connection.execute("UPDATE bots SET name = %s WHERE id = %s", (name, bot_id))

    return bot_id


def owned_bot_listing(client: TestClient) -> list[tuple[str, list[str]]]:
    return [
        (bot["name"], [currency["abbreviation"] for currency in bot["currencies"]])
        for bot in client.get("/owner/bots").json()
    ]


def test_owner_lists_owned_bots_with_their_currencies_including_inactive(
    client: TestClient, connection: psycopg.Connection, owned: UUID, owned_bot: UUID
) -> None:
    deactivate(connection, owned)

    listed = client.get("/owner/bots").json()

    assert [bot["id"] for bot in listed] == [str(owned_bot)]
    assert [(currency["id"], currency["active"]) for currency in listed[0]["currencies"]] == [(str(owned), False)]


def test_owner_bots_are_in_name_order_with_currencies_in_abbreviation_order(
    client: TestClient, connection: psycopg.Connection, owned: UUID
) -> None:
    oat_bot = named_bot(connection, owned, "Oat bot")
    gems = create_botless_currency(connection, "GEM", 100_000)
    connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (oat_bot, gems))
    named_bot(connection, create_currency(connection, "ACE", 100_000), "Ace bot")

    assert owned_bot_listing(client) == [("Ace bot", ["ACE"]), ("Oat bot", ["GEM", "OAT"])]


def test_owner_bots_include_a_bot_with_no_currencies(
    client: TestClient, connection: psycopg.Connection, owned: UUID
) -> None:
    named_bot(connection, owned, "Oat bot")
    connection.execute("UPDATE currencies SET bot_id = NULL WHERE id = %s", (owned,))

    assert owned_bot_listing(client) == [("Oat bot", [])]


def test_owner_bots_leave_out_removed_bots_and_currencies(
    client: TestClient, connection: psycopg.Connection, owned: UUID
) -> None:
    oat_bot = named_bot(connection, owned, "Oat bot")
    gems = create_botless_currency(connection, "GEM", 100_000)
    connection.execute(
        "UPDATE currencies SET bot_id = %s, active = false, removed_at = %s WHERE id = %s", (oat_bot, NOW, gems)
    )
    removed_bot = named_bot(connection, create_currency(connection, "ACE", 100_000), "Ace bot")
    connection.execute("UPDATE bots SET removed_at = %s WHERE id = %s", (NOW, removed_bot))

    assert owned_bot_listing(client) == [("Oat bot", ["OAT"])]


def test_owner_bots_leave_out_other_owners_bots(
    client: TestClient, connection: psycopg.Connection, owned: UUID
) -> None:
    connection.execute("UPDATE bots SET owner_id = %s WHERE id = %s", (USER_ID, bot_of(connection, owned)))

    assert owned_bot_listing(client) == []


def test_owner_bots_need_a_login(client: TestClient) -> None:
    assert client.get("/owner/bots").status_code == 401


def test_bot_settings_start_empty(client: TestClient, owned_bot: UUID) -> None:
    assert client.get(f"/bots/{owned_bot}/settings").json() == {
        "hasApiToken": False,
        "hasWebhookSecret": False,
        "webhookUrl": None,
    }


def test_currency_settings_hold_only_the_daily_cap(client: TestClient, owned: UUID) -> None:
    assert client.get(f"/currencies/{owned}/settings").json() == {"dailyCap": None}


@pytest.mark.parametrize(("method", "path", "body"), CURRENCY_ROUTES)
@pytest.mark.parametrize("user_id", [USER_ID, FIRST_ADMIN_ID])
def test_only_the_owner_can_use_currency_routes(
    client: TestClient, connection: psycopg.Connection, user_id: str, method: str, path: str, body: dict | None
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    log_in(client, connection, user_id)

    response = client.request(method, f"/currencies/{currency_id}{path}", json=body)

    assert response.status_code == 403


@pytest.mark.parametrize(("method", "path", "body"), BOT_ROUTES)
@pytest.mark.parametrize("user_id", [USER_ID, FIRST_ADMIN_ID])
def test_only_the_owner_can_use_bot_routes(
    client: TestClient, connection: psycopg.Connection, user_id: str, method: str, path: str, body: dict | None
) -> None:
    bot_id = bot_of(connection, create_currency(connection, "OAT", 100_000))
    log_in(client, connection, user_id)

    response = client.request(method, f"/bots/{bot_id}{path}", json=body)

    assert (response.status_code, response.json()["message"]) == (403, "You don't own that bot.")


@pytest.mark.parametrize(("method", "path", "body"), BOT_ROUTES)
@pytest.mark.parametrize("state", ["unknown", "removed"])
def test_bot_routes_for_a_missing_bot_are_404(
    client: TestClient,
    connection: psycopg.Connection,
    owned_bot: UUID,
    state: str,
    method: str,
    path: str,
    body: dict | None,
) -> None:
    bot_id = UNKNOWN_ID if state == "unknown" else owned_bot

    if state == "removed":
        connection.execute("UPDATE bots SET removed_at = %s WHERE id = %s", (NOW, owned_bot))

    response = client.request(method, f"/bots/{bot_id}{path}", json=body)

    assert (response.status_code, response.json()["message"]) == (404, "No bot with that ID.")


def test_owner_routes_need_a_login(client: TestClient, connection: psycopg.Connection) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    assert client.get(f"/currencies/{currency_id}/settings").status_code == 401
    assert client.get(f"/bots/{bot_of(connection, currency_id)}/blocks").status_code == 401


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


def test_regenerated_token_works_once_and_is_hidden_after(client: TestClient, owned: UUID, owned_bot: UUID) -> None:
    token = client.post(f"/bots/{owned_bot}/api-token").json()["token"]

    pending = client.get(
        "/transactions/pending", params={"currencyId": str(owned)}, headers={"Authorization": f"Bearer {token}"}
    )

    assert token.startswith("dsc_live_")
    assert pending.status_code == 200
    assert client.get(f"/bots/{owned_bot}/settings").json()["hasApiToken"] is True
    assert token not in client.get(f"/bots/{owned_bot}/settings").text


def test_webhook_url_needs_a_secret_first(client: TestClient, owned_bot: UUID) -> None:
    response = client.put(f"/bots/{owned_bot}/webhook-url", json={"webhookUrl": "https://bot.example.com/hook"})

    assert (response.status_code, response.json()["field"]) == (400, "webhookUrl")


def test_owner_sets_and_removes_the_webhook_url(client: TestClient, owned_bot: UUID) -> None:
    client.post(f"/bots/{owned_bot}/webhook-secret")

    set_response = client.put(f"/bots/{owned_bot}/webhook-url", json={"webhookUrl": " https://bot.example.com/hook "})
    after_set = client.get(f"/bots/{owned_bot}/settings").json()
    client.delete(f"/bots/{owned_bot}/webhook-url")
    after_remove = client.get(f"/bots/{owned_bot}/settings").json()

    assert set_response.status_code == 204
    assert after_set["webhookUrl"] == "https://bot.example.com/hook"
    assert after_set["hasWebhookSecret"] is True
    assert after_remove["webhookUrl"] is None


@pytest.mark.parametrize("url", ["http://bot.example.com/hook", "bot.example.com", "https://"])
def test_webhook_url_must_be_https(client: TestClient, owned_bot: UUID, url: str) -> None:
    client.post(f"/bots/{owned_bot}/webhook-secret")

    response = client.put(f"/bots/{owned_bot}/webhook-url", json={"webhookUrl": url})

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


def test_a_botless_currency_has_no_owner(client: TestClient, connection: psycopg.Connection) -> None:
    currency_id = create_botless_currency(connection, "OAT", 100_000)
    log_in(client, connection, OWNER_ID)

    response = client.get(f"/currencies/{currency_id}/settings")

    assert response.status_code == 403
    assert response.json()["message"].startswith("This currency has no bot yet")
    assert owned_bot_listing(client) == []


def test_ownership_follows_the_bot_owner(client: TestClient, connection: psycopg.Connection, owned: UUID) -> None:
    connection.execute("UPDATE bots SET owner_id = %s WHERE id = %s", (USER_ID, bot_of(connection, owned)))

    assert client.get(f"/currencies/{owned}/settings").status_code == 403


def test_owner_pending_list_covers_every_currency_of_the_bot(
    client: TestClient, connection: psycopg.Connection, owned: UUID, owned_bot: UUID
) -> None:
    gems = create_botless_currency(connection, "GEM", 100_000)
    connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (owned_bot, gems))
    pebbles = create_currency(connection, "PBL", 100_000)
    into_oats = insert_transaction(connection, pebbles, owned, NOW - timedelta(hours=2), status="Pending")
    into_gems = insert_transaction(connection, pebbles, gems, NOW - timedelta(hours=1), status="Pending")
    insert_transaction(connection, owned, pebbles, NOW, status="Pending")
    insert_transaction(connection, pebbles, gems, NOW, status="Completed")

    pending = client.get(f"/bots/{owned_bot}/transactions/pending").json()

    assert [(row["id"], row["toCurrency"]["abbreviation"]) for row in pending] == [
        (str(into_oats), "OAT"),
        (str(into_gems), "GEM"),
    ]


def test_write_lock_refuses_an_owner_change_that_landed_after_the_check(
    connection: psycopg.Connection, owned: UUID
) -> None:
    ownership = require_owner(connection, owned, OWNER_ID)
    connection.execute("UPDATE bots SET owner_id = %s WHERE id = %s", (USER_ID, ownership.bot_id))

    with pytest.raises(ApiError) as refused:
        lock_owned_bot(connection, ownership)

    assert refused.value.status == 403


def test_write_lock_treats_a_bot_removed_after_the_check_as_gone(connection: psycopg.Connection, owned: UUID) -> None:
    ownership = require_owner(connection, owned, OWNER_ID)
    connection.execute("UPDATE bots SET removed_at = now() WHERE id = %s", (ownership.bot_id,))

    with pytest.raises(ApiError) as refused:
        lock_owned_bot(connection, ownership)

    assert refused.value.status == 404


def test_write_lock_waits_for_a_bot_row_held_elsewhere(
    connection: psycopg.Connection, owned: UUID, database_url: str
) -> None:
    ownership = require_owner(connection, owned, OWNER_ID)

    with psycopg.connect(database_url) as holder, psycopg.connect(database_url, row_factory=dict_row) as writer:
        holder.execute("SELECT 1 FROM bots WHERE id = %s FOR UPDATE", (ownership.bot_id,))
        writer.execute(f"SET lock_timeout = '{LOCK_TIMEOUT_MS}ms'")

        with pytest.raises(psycopg.errors.LockNotAvailable):
            lock_owned_bot(writer, ownership)


WRITE_LOCKED = ApiError(418, "write lock taken")


@pytest.mark.parametrize(("method", "path", "body"), CURRENCY_WRITES)
def test_every_currency_write_takes_the_bot_lock(
    client: TestClient, owned: UUID, monkeypatch: pytest.MonkeyPatch, method: str, path: str, body: dict | None
) -> None:
    monkeypatch.setattr(app.owners.access, "lock_owned_bot", refuse_write)

    response = client.request(method, f"/currencies/{owned}{path}", json=body)

    assert response.status_code == WRITE_LOCKED.status


@pytest.mark.parametrize(("method", "path", "body"), BOT_WRITES)
def test_every_bot_write_takes_the_bot_lock(
    client: TestClient, owned_bot: UUID, monkeypatch: pytest.MonkeyPatch, method: str, path: str, body: dict | None
) -> None:
    monkeypatch.setattr(app.owners.access, "lock_owned_bot", refuse_write)

    response = client.request(method, f"/bots/{owned_bot}{path}", json=body)

    assert response.status_code == WRITE_LOCKED.status


def test_bot_write_lock_treats_a_bot_removed_after_the_check_as_gone(
    client: TestClient, connection: psycopg.Connection, owned_bot: UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_lock = app.owners.access.lock_owned_bot

    def remove_then_lock(db: psycopg.Connection, ownership: BotOwnership) -> None:
        connection.execute("UPDATE bots SET removed_at = %s WHERE id = %s", (NOW, owned_bot))
        real_lock(db, ownership)

    monkeypatch.setattr(app.owners.access, "lock_owned_bot", remove_then_lock)

    response = client.post(f"/bots/{owned_bot}/api-token")

    stored = connection.execute("SELECT api_token_hash FROM bots WHERE id = %s", (owned_bot,)).fetchone()
    assert (response.status_code, response.json()["message"]) == (404, "No bot with that ID.")
    assert stored == {"api_token_hash": None}


def test_resend_takes_the_bot_lock(
    client: TestClient, connection: psycopg.Connection, owned: UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    gems = create_currency(connection, "GEM", 100_000)
    pending = insert_transaction(connection, gems, owned, NOW, status="Pending")
    monkeypatch.setattr(app.owners.routes, "lock_owned_bot", refuse_write)

    response = client.post(f"/transactions/{pending}/resend-webhook")

    assert response.status_code == WRITE_LOCKED.status


def test_resend_reads_the_status_after_taking_the_bot_lock(
    client: TestClient, connection: psycopg.Connection, owned: UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    gems = create_currency(connection, "GEM", 100_000)
    pending = insert_transaction(connection, gems, owned, NOW, status="Pending")
    real_lock = app.owners.routes.lock_owned_bot

    def refund_then_lock(db: psycopg.Connection, ownership: BotOwnership) -> None:
        connection.execute("UPDATE transactions SET status = 'Refunded', handled_at = %s WHERE id = %s", (NOW, pending))
        real_lock(db, ownership)

    monkeypatch.setattr(app.owners.routes, "lock_owned_bot", refund_then_lock)

    response = client.post(f"/transactions/{pending}/resend-webhook")

    deliveries = connection.execute("SELECT count(*) AS deliveries FROM webhook_deliveries").fetchone()
    assert (response.status_code, response.json()["message"]) == (400, "Only Pending transactions can be resent.")
    assert deliveries == {"deliveries": 0}


def refuse_write(*arguments: object) -> None:
    raise WRITE_LOCKED


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", "", {"name": "Renamed", "abbreviation": "RNM"}),
        ("PUT", "/daily-cap", {"dailyCap": 10}),
        ("DELETE", "/daily-cap", None),
    ],
)
def test_currency_write_refuses_a_removal_that_landed_after_the_check(
    client: TestClient,
    connection: psycopg.Connection,
    owned: UUID,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    body: dict | None,
) -> None:
    real_lock = app.owners.access.lock_owned_bot

    def remove_then_lock(db: psycopg.Connection, ownership: Ownership) -> None:
        connection.execute("UPDATE currencies SET active = false, removed_at = %s WHERE id = %s", (NOW, owned))
        real_lock(db, ownership)

    monkeypatch.setattr(app.owners.access, "lock_owned_bot", remove_then_lock)

    response = client.request(method, f"/currencies/{owned}{path}", json=body)

    stored = connection.execute("SELECT name, daily_cap FROM currencies WHERE id = %s", (owned,)).fetchone()
    assert response.status_code == 404
    assert stored == {"name": "OAT coin", "daily_cap": None}


def stored_details(connection: psycopg.Connection, currency_id: UUID) -> tuple[str, object]:
    stored = connection.execute("SELECT name, daily_cap FROM currencies WHERE id = %s", (currency_id,)).fetchone()

    return stored["name"], stored["daily_cap"]


def refusal_of(response: Response) -> tuple[int, str, str]:
    body = response.json()

    return response.status_code, body["message"], body["field"]


@pytest.mark.parametrize(("method", "path", "body"), CURRENCY_WRITES)
def test_owner_writes_on_an_inactive_currency_are_refused(
    client: TestClient, connection: psycopg.Connection, owned: UUID, method: str, path: str, body: dict | None
) -> None:
    connection.execute("UPDATE currencies SET daily_cap = %s WHERE id = %s", (STORED_CAP, owned))
    deactivate(connection, owned)

    response = client.request(method, f"/currencies/{owned}{path}", json=body)

    assert refusal_of(response) == INACTIVE_REFUSAL
    assert stored_details(connection, owned) == ("OAT coin", STORED_CAP)


@pytest.mark.parametrize(("method", "path", "body"), CURRENCY_WRITES)
def test_currency_write_refuses_a_deactivation_that_landed_after_the_check(
    client: TestClient,
    connection: psycopg.Connection,
    owned: UUID,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    body: dict | None,
) -> None:
    connection.execute("UPDATE currencies SET daily_cap = %s WHERE id = %s", (STORED_CAP, owned))
    real_lock = app.owners.access.lock_owned_bot

    def deactivate_then_lock(db: psycopg.Connection, ownership: Ownership) -> None:
        deactivate(connection, owned)
        real_lock(db, ownership)

    monkeypatch.setattr(app.owners.access, "lock_owned_bot", deactivate_then_lock)

    response = client.request(method, f"/currencies/{owned}{path}", json=body)

    assert refusal_of(response) == INACTIVE_REFUSAL
    assert stored_details(connection, owned) == ("OAT coin", STORED_CAP)


@pytest.mark.parametrize(("method", "path", "body"), CURRENCY_WRITES)
def test_owner_writes_work_again_once_an_admin_reactivates(
    client: TestClient, connection: psycopg.Connection, owned: UUID, method: str, path: str, body: dict | None
) -> None:
    deactivate(connection, owned)
    owner_session = client.cookies.get(SESSION_COOKIE)
    log_in(client, connection, FIRST_ADMIN_ID)
    reactivated = client.patch(f"/admin/currencies/{owned}", json={"active": True})
    client.cookies.set(SESSION_COOKIE, owner_session)

    response = client.request(method, f"/currencies/{owned}{path}", json=body)

    assert reactivated.status_code == 200
    assert response.is_success


def test_bot_routes_still_work_when_a_currency_of_the_bot_is_inactive(
    client: TestClient, connection: psycopg.Connection, owned: UUID, owned_bot: UUID
) -> None:
    deactivate(connection, owned)

    assert client.post(f"/bots/{owned_bot}/api-token").status_code == 200
    assert client.get(f"/bots/{owned_bot}/settings").status_code == 200


def test_unknown_currency_is_404(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, OWNER_ID)

    assert client.get("/currencies/019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21/settings").status_code == 404
