from collections.abc import Callable
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth.discord import DiscordOAuth
from app.auth.routes import STATE_COOKIE, discord_oauth
from app.auth.sessions import SESSION_COOKIE
from tests.factories import (
    ADMIN_ID,
    FRONTEND_URL,
    NOW,
    OWNER_ID,
    USER_ID,
    bot_name,
    bot_of,
    create_bot,
    create_botless_currency,
    create_currency,
    create_transaction,
    log_in,
)

DiscordHandler = Callable[[httpx.Request], httpx.Response]


def fake_discord_responses(request: httpx.Request) -> httpx.Response:
    if request.url.path.endswith("/oauth2/token"):
        assert parse_qs(request.content.decode())["code"] == ["good-code"]

        return httpx.Response(200, json={"access_token": "discord-access"})

    assert request.headers["Authorization"] == "Bearer discord-access"

    return httpx.Response(
        200, json={"id": USER_ID, "username": "trader", "global_name": "Trader Joe", "avatar": "abc123"}
    )


def use_fake_discord(client: TestClient, handler: DiscordHandler) -> None:
    http = httpx.Client(transport=httpx.MockTransport(handler))
    fake = DiscordOAuth("discord-client", "discord-secret", "https://api.example.com/auth/discord/callback", http)
    client.app.dependency_overrides[discord_oauth] = lambda: fake


def start_login(client: TestClient) -> str:
    response = client.get("/auth/discord/login", follow_redirects=False)
    query = parse_qs(urlsplit(response.headers["location"]).query)

    assert query["client_id"] == ["discord-client"]
    assert query["scope"] == ["identify"]

    return query["state"][0]


def test_login_redirects_to_discord_with_state(client: TestClient) -> None:
    response = client.get("/auth/discord/login", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].startswith("https://discord.com/oauth2/authorize?")
    assert STATE_COOKIE in response.cookies


def test_callback_logs_the_user_in(client: TestClient, connection: psycopg.Connection) -> None:
    use_fake_discord(client, fake_discord_responses)
    state = start_login(client)

    response = client.get(
        "/auth/discord/callback", params={"state": state, "code": "good-code"}, follow_redirects=False
    )

    assert response.status_code == 303
    assert response.headers["location"] == FRONTEND_URL
    assert SESSION_COOKIE in response.cookies
    assert client.get("/me").json() == {
        "userId": USER_ID,
        "username": "Trader Joe",
        "avatarUrl": f"https://cdn.discordapp.com/avatars/{USER_ID}/abc123.png?size=64",
        "defaultAvatarUrl": f"https://cdn.discordapp.com/embed/avatars/{(int(USER_ID) >> 22) % 6}.png",
        "isAdmin": False,
        "ownedBots": [],
    }


def test_callback_rejects_a_wrong_state(client: TestClient) -> None:
    use_fake_discord(client, fake_discord_responses)
    start_login(client)

    response = client.get("/auth/discord/callback", params={"state": "forged", "code": "good-code"})

    assert response.status_code == 400
    assert response.json()["field"] == "state"


def test_callback_without_a_login_cookie_is_rejected(client: TestClient) -> None:
    use_fake_discord(client, fake_discord_responses)

    response = client.get("/auth/discord/callback", params={"state": "any", "code": "good-code"})

    assert response.status_code == 400


def test_callback_reports_a_discord_failure(client: TestClient) -> None:
    use_fake_discord(client, lambda request: httpx.Response(401, json={"error": "invalid_grant"}))
    state = start_login(client)

    response = client.get("/auth/discord/callback", params={"state": state, "code": "bad-code"})

    assert response.status_code == 502
    assert response.json()["message"] == "Discord didn't confirm the login. Try again."


def test_me_needs_a_login(client: TestClient) -> None:
    response = client.get("/me")

    assert response.status_code == 401
    assert response.json() == {"status": 401, "message": "Log in with Discord first.", "field": None}


def test_me_rejects_an_unknown_or_expired_session(client: TestClient, connection: psycopg.Connection) -> None:
    client.cookies.set(SESSION_COOKIE, "made-up")
    unknown = client.get("/me")
    log_in(client, connection, USER_ID)
    connection.execute("UPDATE sessions SET expires_at = %s", (NOW - timedelta(seconds=1),))
    expired = client.get("/me")

    assert (unknown.status_code, expired.status_code) == (401, 401)


def test_me_lists_owned_live_bots_with_their_live_currencies(
    client: TestClient, connection: psycopg.Connection
) -> None:
    owned = create_currency(connection, "OAT", 100_000)
    bot_id = bot_of(connection, owned)
    removed = create_botless_currency(connection, "GEM", 100_000)
    connection.execute(
        "UPDATE currencies SET bot_id = %s, active = false, removed_at = %s WHERE id = %s", (bot_id, NOW, removed)
    )
    empty_bot = create_bot(connection)
    connection.execute("UPDATE bots SET removed_at = %s WHERE id = %s", (NOW, create_bot(connection)))
    create_botless_currency(connection, "PBL", 100_000)
    log_in(client, connection, OWNER_ID)

    bots = client.get("/me").json()["ownedBots"]

    assert sorted((bot["id"], bot["name"], bot["currencyIds"]) for bot in bots) == sorted(
        [
            (str(bot_id), bot_name(connection, bot_id), [str(owned)]),
            (str(empty_bot), bot_name(connection, empty_bot), []),
        ]
    )


def test_seeded_admin_is_admin_after_login(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, ADMIN_ID)

    assert client.get("/me").json()["isAdmin"] is True


def test_logout_ends_the_session(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, USER_ID)

    response = client.post("/auth/logout")

    assert response.status_code == 204
    assert connection.execute("SELECT count(*) AS sessions FROM sessions").fetchone() == {"sessions": 0}


def test_my_transactions_are_mine_only(client: TestClient, connection: psycopg.Connection) -> None:
    oats = create_currency(connection, "OAT", 100_000)
    gems = create_currency(connection, "GEM", 100_000)
    mine = create_transaction(connection, oats, gems, NOW - timedelta(hours=1))
    create_transaction(connection, oats, gems, NOW - timedelta(hours=2), user_id=OWNER_ID)
    log_in(client, connection, USER_ID)

    assert [transaction["id"] for transaction in client.get("/me/transactions").json()] == [str(mine)]


def log_in_through_discord(client: TestClient, next_path: str) -> httpx.Response:
    use_fake_discord(client, fake_discord_responses)
    response = client.get("/auth/discord/login", params={"next": next_path}, follow_redirects=False)
    state = parse_qs(urlsplit(response.headers["location"]).query)["state"][0]

    return client.get("/auth/discord/callback", params={"state": state, "code": "good-code"}, follow_redirects=False)


@pytest.mark.parametrize("next_path", ["/owner", "/currency/OAT?days=30", "/admin#blocks"])
def test_login_returns_to_the_requested_page(client: TestClient, next_path: str) -> None:
    response = log_in_through_discord(client, next_path)

    assert response.status_code == 303
    assert response.headers["location"] == FRONTEND_URL.rstrip("/") + next_path


@pytest.mark.parametrize(
    "next_path",
    [
        "//evil.example.com",
        "https://evil.example.com",
        "javascript:alert(1)",
        "owner",
        r"/\evil.example.com",
        "\\evil.example.com",
        "/owner\nSet-Cookie: x=1",
        "/owner\t",
        "",
        "/" + "a" * 2000,
    ],
)
def test_login_refuses_paths_off_the_site(client: TestClient, next_path: str) -> None:
    response = client.get("/auth/discord/login", params={"next": next_path}, follow_redirects=False)

    assert response.status_code == 400
    assert response.json()["field"] == "next"
    assert STATE_COOKIE not in response.cookies
