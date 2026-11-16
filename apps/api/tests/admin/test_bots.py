from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.bots.tokens import issue_api_token
from app.core.errors import ApiError
from app.transactions.ledger import create_transaction
from tests.factories import (
    FIRST_ADMIN_ID,
    NOW,
    OWNER_ID,
    USER_ID,
    bot_of,
    create_bot,
    create_botless_currency,
    create_currency,
    log_in,
)
from tests.factories import create_transaction as insert_transaction
from tests.webhooks.receiver import connect_webhook

BOT_DISCORD_ID = "410000000000000001"
OTHER_USER_ID = "500000000000000005"
UNKNOWN_ID = "019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21"


@pytest.fixture
def as_admin(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, FIRST_ADMIN_ID)


def new_bot(**changes: str) -> dict:
    return {"name": "Oat bot", "discordId": BOT_DISCORD_ID, "ownerId": OWNER_ID, **changes}


def stored_bot(connection: psycopg.Connection, bot_id: UUID | str) -> dict:
    return connection.execute(
        "SELECT name, discord_id, owner_id, api_token_hash, webhook_url, webhook_secret_sealed FROM bots WHERE id = %s",
        (bot_id,),
    ).fetchone()


def block_on(connection: psycopg.Connection, currency_id: UUID, user_id: str, hours_ago: int) -> int:
    row = connection.execute(
        """
        INSERT INTO blocks (user_id, currency_id, reason, blocked_by, blocked_at)
        VALUES (%s, %s, 'Spam', %s, %s) RETURNING id
        """,
        (user_id, currency_id, OWNER_ID, NOW - timedelta(hours=hours_ago)),
    ).fetchone()

    return row["id"]


def assign(client: TestClient, currency_id: UUID, bot_id: UUID | None) -> dict:
    sent = None if bot_id is None else str(bot_id)
    response = client.patch(f"/admin/currencies/{currency_id}", json={"botId": sent})

    return {"http": response.status_code, **response.json()}


def test_admin_registers_a_bot(client: TestClient, as_admin: None) -> None:
    response = client.post("/admin/bots", json=new_bot(name=" Oat bot "))

    created = response.json()
    assert response.status_code == 201
    assert {key: created[key] for key in ("name", "discordId", "ownerId", "currencyCount")} == {
        "name": "Oat bot",
        "discordId": BOT_DISCORD_ID,
        "ownerId": OWNER_ID,
        "currencyCount": 0,
    }
    assert [bot["id"] for bot in client.get("/admin/bots").json()] == [created["id"]]


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"name": "  "}, "name"),
        ({"discordId": "42"}, "discordId"),
        ({"discordId": "41000000000000000a"}, "discordId"),
        ({"ownerId": "123"}, "ownerId"),
    ],
)
def test_registering_checks_every_field(
    client: TestClient, connection: psycopg.Connection, as_admin: None, changes: dict, field: str
) -> None:
    response = client.post("/admin/bots", json=new_bot(**changes))

    assert (response.status_code, response.json()["field"]) == (400, field)
    assert connection.execute("SELECT count(*) AS bots FROM bots").fetchone()["bots"] == 0


def test_a_live_bot_discord_id_is_taken(client: TestClient, as_admin: None) -> None:
    client.post("/admin/bots", json=new_bot())

    response = client.post("/admin/bots", json=new_bot(name="Copy"))

    assert (response.status_code, response.json()["field"]) == (409, "discordId")


def test_a_racing_duplicate_discord_id_is_the_same_field_error(client: TestClient, as_admin: None) -> None:
    client.post("/admin/bots", json=new_bot())

    with patch("app.admin.bots.discord_id_in_use", return_value=False):
        response = client.post("/admin/bots", json=new_bot(name="Copy"))

    assert (response.status_code, response.json()["field"]) == (409, "discordId")


def test_editing_into_a_live_bot_discord_id_is_refused(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    client.post("/admin/bots", json=new_bot())
    bot_id = create_bot(connection)

    response = client.patch(f"/admin/bots/{bot_id}", json={"discordId": BOT_DISCORD_ID})

    assert (response.status_code, response.json()["field"]) == (409, "discordId")


def test_bot_list_counts_live_currencies(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    oats = create_currency(connection, "OAT", 100_000)
    gems = create_botless_currency(connection, "GEM", 100_000)
    connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (bot_of(connection, oats), gems))

    listed = client.get("/admin/bots").json()

    assert [bot["currencyCount"] for bot in listed] == [2]


def test_admin_renames_a_bot_and_changes_its_discord_id(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    bot_id = create_bot(connection)
    issue_api_token(connection, bot_id)

    response = client.patch(f"/admin/bots/{bot_id}", json={"name": "Renamed", "discordId": BOT_DISCORD_ID})

    stored = stored_bot(connection, bot_id)
    assert response.status_code == 200
    assert (stored["name"], stored["discord_id"]) == ("Renamed", BOT_DISCORD_ID)
    assert stored["api_token_hash"] is not None


def test_editing_a_bot_needs_a_change(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    bot_id = create_bot(connection)

    assert client.patch(f"/admin/bots/{bot_id}", json={}).status_code == 400


@pytest.mark.parametrize(("body", "field"), [({"name": None}, "name"), ({"ownerId": "1"}, "ownerId")])
def test_editing_a_bot_checks_its_fields(
    client: TestClient, connection: psycopg.Connection, as_admin: None, body: dict, field: str
) -> None:
    bot_id = create_bot(connection)

    response = client.patch(f"/admin/bots/{bot_id}", json=body)

    assert (response.status_code, response.json()["field"]) == (400, field)


def test_new_owner_clears_the_token_and_webhook_and_keeps_blocks(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_currency(connection, "OAT", 100_000)
    bot_id = bot_of(connection, oats)
    token = issue_api_token(connection, bot_id)
    connect_webhook(connection, oats)
    connection.execute(
        "INSERT INTO blocks (user_id, bot_id, reason, blocked_by, blocked_at) VALUES (%s, %s, 'Spam', %s, %s)",
        (USER_ID, bot_id, OWNER_ID, NOW),
    )

    response = client.patch(f"/admin/bots/{bot_id}", json={"ownerId": OTHER_USER_ID})

    stored = stored_bot(connection, bot_id)
    active_blocks = connection.execute("SELECT count(*) AS blocks FROM blocks WHERE unblocked_at IS NULL").fetchone()
    pending = client.get(
        "/transactions/pending", params={"currencyId": str(oats)}, headers={"Authorization": f"Bearer {token}"}
    )
    assert response.json()["ownerId"] == OTHER_USER_ID
    assert (stored["api_token_hash"], stored["webhook_url"], stored["webhook_secret_sealed"]) == (None, None, None)
    assert active_blocks["blocks"] == 1
    assert pending.status_code == 401


def test_same_owner_keeps_the_token(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    bot_id = create_bot(connection)
    issue_api_token(connection, bot_id)

    client.patch(f"/admin/bots/{bot_id}", json={"ownerId": OWNER_ID, "name": "Same owner"})

    assert stored_bot(connection, bot_id)["api_token_hash"] is not None


def test_owner_change_drops_waiting_webhooks(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    connect_webhook(connection, oats)
    create_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)

    client.patch(f"/admin/bots/{bot_of(connection, oats)}", json={"ownerId": OTHER_USER_ID})

    delivery = connection.execute("SELECT state, last_error FROM webhook_deliveries").fetchone()
    assert delivery == {"state": "dropped", "last_error": "The bot changed owner."}


def test_unknown_bot_is_404(client: TestClient, as_admin: None) -> None:
    assert client.patch(f"/admin/bots/{UNKNOWN_ID}", json={"name": "Nope"}).status_code == 404


def test_botless_currency_gets_its_bot_once(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    oats = create_botless_currency(connection, "OAT", 100_000)
    bot_id = create_bot(connection)

    response = assign(client, oats, bot_id)

    assert response["http"] == 200
    assert response["saved"]["bot"]["id"] == str(bot_id)
    assert response["movedBlocks"] == 0
    assert bot_of(connection, oats) == bot_id


@pytest.mark.parametrize("next_bot", ["same", "other", "none"])
def test_a_currency_with_a_bot_cannot_change_or_lose_it(
    client: TestClient, connection: psycopg.Connection, as_admin: None, next_bot: str
) -> None:
    oats = create_currency(connection, "OAT", 100_000)
    bot_id = bot_of(connection, oats)
    target = {"same": bot_id, "other": create_bot(connection), "none": None}[next_bot]

    response = assign(client, oats, target)

    assert (response["http"], response["field"]) == (409, "botId")
    assert bot_of(connection, oats) == bot_id


def test_clearing_the_bot_of_a_botless_currency_is_refused(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_botless_currency(connection, "OAT", 100_000)

    response = assign(client, oats, None)

    assert (response["http"], response["field"]) == (400, "botId")


def test_a_removed_bot_cannot_be_assigned(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    oats = create_botless_currency(connection, "OAT", 100_000)
    bot_id = create_bot(connection)
    client.delete(f"/admin/bots/{bot_id}")

    response = assign(client, oats, bot_id)

    assert (response["http"], response["field"]) == (404, "botId")
    assert bot_of(connection, oats) is None


def test_assignment_moves_blocks_to_the_bot(client: TestClient, connection: psycopg.Connection, as_admin: None) -> None:
    oats = create_botless_currency(connection, "OAT", 100_000)
    block_id = block_on(connection, oats, USER_ID, 2)
    bot_id = create_bot(connection)

    response = assign(client, oats, bot_id)

    block = connection.execute("SELECT currency_id, bot_id, unblocked_at FROM blocks WHERE id = %s", (block_id,))
    assert response["movedBlocks"] == 1
    assert block.fetchone() == {"currency_id": None, "bot_id": bot_id, "unblocked_at": None}


def test_assignment_widens_blocks_to_every_bot_currency(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_botless_currency(connection, "OAT", 1_000_000)
    gems = create_botless_currency(connection, "GEM", 1_000_000)
    block_on(connection, gems, USER_ID, 1)
    bot_id = create_bot(connection)
    assign(client, oats, bot_id)
    assign(client, gems, bot_id)
    pebbles = create_currency(connection, "PBL", 1_000_000)

    with pytest.raises(ApiError, match="blocked"):
        create_transaction(connection, USER_ID, pebbles, oats, Decimal(1000), NOW)


def test_merging_keeps_the_earliest_block_and_closes_the_other(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_botless_currency(connection, "OAT", 1_000_000)
    gems = create_botless_currency(connection, "GEM", 1_000_000)
    later = block_on(connection, gems, USER_ID, 1)
    earliest = block_on(connection, oats, USER_ID, 5)
    other_user = block_on(connection, gems, OTHER_USER_ID, 1)
    linked = insert_transaction(connection, oats, gems, NOW - timedelta(days=1), status="Reversed")
    connection.execute("UPDATE transactions SET block_id = %s WHERE id = %s", (later, linked))
    bot_id = create_bot(connection)
    assign(client, gems, bot_id)

    response = assign(client, oats, bot_id)

    blocks = connection.execute(
        "SELECT id, bot_id, unblocked_at, unblocked_by, merged_into FROM blocks ORDER BY id"
    ).fetchall()
    link = connection.execute("SELECT block_id FROM transactions WHERE id = %s", (linked,)).fetchone()
    assert response["movedBlocks"] == 1
    assert blocks == [
        {"id": later, "bot_id": bot_id, "unblocked_at": NOW, "unblocked_by": FIRST_ADMIN_ID, "merged_into": earliest},
        {"id": earliest, "bot_id": bot_id, "unblocked_at": None, "unblocked_by": None, "merged_into": None},
        {"id": other_user, "bot_id": bot_id, "unblocked_at": None, "unblocked_by": None, "merged_into": None},
    ]
    assert link == {"block_id": later}


def test_merging_closes_the_later_block_that_arrives_second(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_botless_currency(connection, "OAT", 1_000_000)
    gems = create_botless_currency(connection, "GEM", 1_000_000)
    earliest = block_on(connection, oats, USER_ID, 5)
    later = block_on(connection, gems, USER_ID, 1)
    bot_id = create_bot(connection)
    assign(client, oats, bot_id)

    assign(client, gems, bot_id)

    closed = connection.execute("SELECT currency_id, merged_into FROM blocks WHERE id = %s", (later,)).fetchone()
    assert closed == {"currency_id": gems, "merged_into": earliest}


def test_blocks_on_a_botless_currency_keep_applying(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_botless_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    block_on(connection, oats, USER_ID, 1)

    with pytest.raises(ApiError, match="blocked"):
        create_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)


def test_botless_currency_accepts_transactions_and_waits(
    client: TestClient, connection: psycopg.Connection, as_admin: None
) -> None:
    oats = create_botless_currency(connection, "OAT", 1_000_000)
    gems = create_currency(connection, "GEM", 1_000_000)
    connect_webhook(connection, gems)
    waiting = create_transaction(connection, USER_ID, gems, oats, Decimal(1000), NOW)
    bot_id = create_bot(connection)
    assign(client, oats, bot_id)
    log_in(client, connection, OWNER_ID)

    pending = client.get(f"/bots/{bot_id}/transactions/pending").json()

    deliveries = connection.execute("SELECT count(*) AS deliveries FROM webhook_deliveries").fetchone()
    assert waiting["status"] == "Pending"
    assert deliveries["deliveries"] == 0
    assert [transaction["id"] for transaction in pending] == [str(waiting["id"])]
