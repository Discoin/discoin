from collections.abc import Callable
from datetime import timedelta
from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from httpx import Response

import app.owners.access
from app.auth.sessions import SESSION_COOKIE
from app.owners.access import BotOwnership
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
    remove_currency,
)
from tests.factories import create_transaction as insert_transaction

STORED_CAP = Decimal("50.00")
INACTIVE_REFUSAL = (
    400,
    "OAT is inactive, so its settings can't be changed until a Discoin admin reactivates it.",
    "currencyId",
)
CURRENCY_READ = ("GET", "/currencies/{currency}/settings", None)
CURRENCY_WRITE = ("PUT", "/currencies/{currency}/daily-cap", {"dailyCap": 10})
BOT_READ = ("GET", "/bots/{bot}/settings", None)
BOT_WRITE = ("POST", "/bots/{bot}/api-token", None)
GUARDED_ROUTES = [
    pytest.param(*CURRENCY_READ, "currency", id="currency read"),
    pytest.param(*CURRENCY_WRITE, "currency", id="currency write"),
    pytest.param(*BOT_READ, "bot", id="bot read"),
    pytest.param(*BOT_WRITE, "bot", id="bot write"),
]
Change = Callable[[psycopg.Connection, UUID, UUID], None]


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


def move_to_bot(connection: psycopg.Connection, currency_id: UUID, bot_id: UUID) -> None:
    connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (bot_id, currency_id))


def stored_details(connection: psycopg.Connection, currency_id: UUID) -> tuple[str, object]:
    stored = connection.execute("SELECT name, daily_cap FROM currencies WHERE id = %s", (currency_id,)).fetchone()

    return stored["name"], stored["daily_cap"]


def refusal_of(response: Response) -> tuple[int, str, str]:
    body = response.json()

    return response.status_code, body["message"], body["field"]


def request_guarded(
    client: TestClient, method: str, path: str, body: dict | None, currency_id: object, bot_id: object
) -> Response:
    return client.request(method, path.format(currency=currency_id, bot=bot_id), json=body)


def remove_the_currency(connection: psycopg.Connection, currency_id: UUID, bot_id: UUID) -> None:
    remove_currency(connection, currency_id)


def deactivate_the_currency(connection: psycopg.Connection, currency_id: UUID, bot_id: UUID) -> None:
    deactivate(connection, currency_id)


def remove_the_bot(connection: psycopg.Connection, currency_id: UUID, bot_id: UUID) -> None:
    connection.execute("UPDATE bots SET removed_at = %s WHERE id = %s", (NOW, bot_id))


def hand_the_bot_over(connection: psycopg.Connection, currency_id: UUID, bot_id: UUID) -> None:
    connection.execute("UPDATE bots SET owner_id = %s WHERE id = %s", (USER_ID, bot_id))


def test_owner_lists_only_their_live_bots_in_name_order_with_live_currencies(
    client: TestClient, connection: psycopg.Connection, owned: UUID
) -> None:
    oat_bot = named_bot(connection, owned, "Oat bot")
    deactivate(connection, owned)
    gems = create_botless_currency(connection, "GEM", 100_000)
    move_to_bot(connection, gems, oat_bot)
    gone = create_botless_currency(connection, "GNE", 100_000)
    move_to_bot(connection, gone, oat_bot)
    remove_currency(connection, gone)
    named_bot(connection, create_currency(connection, "ACE", 100_000), "Ace bot")
    connection.execute("UPDATE bots SET name = 'Empty bot' WHERE id = %s", (create_bot(connection),))
    removed_bot = named_bot(connection, create_currency(connection, "RMV", 100_000), "Removed bot")
    connection.execute("UPDATE bots SET removed_at = %s WHERE id = %s", (NOW, removed_bot))
    create_bot(connection, USER_ID)

    listed = client.get("/owner/bots").json()

    assert [(bot["name"], [currency["abbreviation"] for currency in bot["currencies"]]) for bot in listed] == [
        ("Ace bot", ["ACE"]),
        ("Empty bot", []),
        ("Oat bot", ["GEM", "OAT"]),
    ]
    assert [currency["active"] for currency in listed[2]["currencies"]] == [True, False]


def test_owner_routes_need_a_login(client: TestClient, connection: psycopg.Connection) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)

    assert client.get("/owner/bots").status_code == 401
    assert client.get(f"/currencies/{currency_id}/settings").status_code == 401
    assert client.get(f"/bots/{bot_of(connection, currency_id)}/blocks").status_code == 401


def test_bot_settings_start_empty(client: TestClient, owned_bot: UUID) -> None:
    assert client.get(f"/bots/{owned_bot}/settings").json() == {
        "hasApiToken": False,
        "hasWebhookSecret": False,
        "webhookUrl": None,
    }


@pytest.mark.parametrize(("method", "path", "body", "subject"), GUARDED_ROUTES)
def test_an_admin_who_is_not_the_owner_is_refused(
    client: TestClient, connection: psycopg.Connection, method: str, path: str, body: dict | None, subject: str
) -> None:
    currency_id = create_currency(connection, "OAT", 100_000)
    log_in(client, connection, ADMIN_ID)

    response = request_guarded(client, method, path, body, currency_id, bot_of(connection, currency_id))

    assert (response.status_code, response.json()["message"]) == (403, f"You don't own that {subject}.")


@pytest.mark.parametrize(("method", "path", "body", "subject"), GUARDED_ROUTES)
@pytest.mark.parametrize("removed", [False, True], ids=["unknown", "removed"])
def test_a_missing_currency_or_bot_is_404(
    client: TestClient,
    connection: psycopg.Connection,
    owned: UUID,
    owned_bot: UUID,
    removed: bool,
    method: str,
    path: str,
    body: dict | None,
    subject: str,
) -> None:
    ids = (owned, owned_bot) if removed else (UNKNOWN_ID, UNKNOWN_ID)

    if removed:
        remove_the_bot(connection, owned, owned_bot)
        remove_currency(connection, owned)

    response = request_guarded(client, method, path, body, *ids)

    assert (response.status_code, response.json()["message"]) == (404, f"No {subject} with that ID.")


def test_owner_renames_the_currency(client: TestClient, owned: UUID) -> None:
    renamed = client.patch(f"/currencies/{owned}", json={"name": " Rolled Oats ", "abbreviation": "roat"})
    kept = client.patch(f"/currencies/{owned}", json={"name": "Oaty", "abbreviation": "ROAT"})

    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["abbreviation"]) == ("Rolled Oats", "ROAT")
    assert client.get("/currencies/ROAT").status_code == 200
    assert kept.status_code == 200


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

    assert token.startswith("dsc_")
    assert not token.startswith("dsc_live_")
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


@pytest.mark.parametrize(
    "url",
    [
        "http://bot.example.com/hook",
        "bot.example.com",
        "https://",
        "https://127.0.0.1/hook",
        "https://localhost/hook",
        "https://[::1]/hook",
    ],
)
def test_webhook_url_must_be_https_on_a_public_host(client: TestClient, owned_bot: UUID, url: str) -> None:
    client.post(f"/bots/{owned_bot}/webhook-secret")

    response = client.put(f"/bots/{owned_bot}/webhook-url", json={"webhookUrl": url})

    assert (response.status_code, response.json()["field"]) == (400, "webhookUrl")


def test_owner_sets_and_removes_the_daily_cap(client: TestClient, owned: UUID) -> None:
    client.put(f"/currencies/{owned}/daily-cap", json={"dailyCap": 250.5})
    after_set = client.get(f"/currencies/{owned}/settings").json()["dailyCap"]
    client.delete(f"/currencies/{owned}/daily-cap")

    assert after_set == 250.5
    assert client.get(f"/currencies/{owned}/settings").json() == {"dailyCap": None}


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
    assert client.get("/owner/bots").json() == []


def test_ownership_follows_the_bot_owner(client: TestClient, connection: psycopg.Connection, owned: UUID) -> None:
    connection.execute("UPDATE bots SET owner_id = %s WHERE id = %s", (USER_ID, bot_of(connection, owned)))

    assert client.get(f"/currencies/{owned}/settings").status_code == 403


def test_owner_pending_list_covers_every_currency_of_the_bot(
    client: TestClient, connection: psycopg.Connection, owned: UUID, owned_bot: UUID
) -> None:
    gems = create_botless_currency(connection, "GEM", 100_000)
    move_to_bot(connection, gems, owned_bot)
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


@pytest.mark.parametrize(
    ("route", "change", "status"),
    [
        (BOT_WRITE, remove_the_bot, 404),
        (BOT_WRITE, hand_the_bot_over, 403),
        (CURRENCY_WRITE, remove_the_currency, 404),
        (CURRENCY_WRITE, deactivate_the_currency, INACTIVE_REFUSAL[0]),
    ],
    ids=["bot removed", "bot handed over", "currency removed", "currency deactivated"],
)
def test_a_write_refuses_a_change_that_landed_after_the_ownership_check(
    client: TestClient,
    connection: psycopg.Connection,
    owned: UUID,
    owned_bot: UUID,
    monkeypatch: pytest.MonkeyPatch,
    route: tuple[str, str, dict | None],
    change: Change,
    status: int,
) -> None:
    connection.execute("UPDATE currencies SET daily_cap = %s WHERE id = %s", (STORED_CAP, owned))
    real_lock = app.owners.access.lock_owned_bot

    def change_then_lock(db: psycopg.Connection, ownership: BotOwnership) -> None:
        change(connection, owned, owned_bot)
        real_lock(db, ownership)

    monkeypatch.setattr(app.owners.access, "lock_owned_bot", change_then_lock)

    response = request_guarded(client, *route, owned, owned_bot)

    token = connection.execute("SELECT api_token_hash FROM bots WHERE id = %s", (owned_bot,)).fetchone()
    assert response.status_code == status
    assert token == {"api_token_hash": None}
    assert stored_details(connection, owned) == ("OAT coin", STORED_CAP)


def test_owner_writes_on_an_inactive_currency_are_refused(
    client: TestClient, connection: psycopg.Connection, owned: UUID
) -> None:
    connection.execute("UPDATE currencies SET daily_cap = %s WHERE id = %s", (STORED_CAP, owned))
    deactivate(connection, owned)

    response = client.put(f"/currencies/{owned}/daily-cap", json={"dailyCap": 10})

    assert refusal_of(response) == INACTIVE_REFUSAL
    assert stored_details(connection, owned) == ("OAT coin", STORED_CAP)


def test_owner_writes_work_again_once_an_admin_reactivates(
    client: TestClient, connection: psycopg.Connection, owned: UUID
) -> None:
    deactivate(connection, owned)
    owner_session = client.cookies.get(SESSION_COOKIE)
    log_in(client, connection, ADMIN_ID)
    reactivated = client.patch(f"/admin/currencies/{owned}", json={"active": True})
    client.cookies.set(SESSION_COOKIE, owner_session)

    response = client.put(f"/currencies/{owned}/daily-cap", json={"dailyCap": 10})

    assert reactivated.status_code == 200
    assert response.is_success


def test_bot_routes_still_work_when_a_currency_of_the_bot_is_inactive(
    client: TestClient, connection: psycopg.Connection, owned: UUID, owned_bot: UUID
) -> None:
    deactivate(connection, owned)

    assert client.post(f"/bots/{owned_bot}/api-token").status_code == 200
    assert client.get(f"/bots/{owned_bot}/settings").status_code == 200
