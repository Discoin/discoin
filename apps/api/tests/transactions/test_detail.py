from collections.abc import Callable
from datetime import timedelta
from uuid import UUID, uuid7

import psycopg
import pytest
from fastapi.testclient import TestClient
from httpx import Response
from psycopg.rows import dict_row

from app.auth.sessions import SESSION_COOKIE, User, hash_secret
from app.bots.tokens import issue_api_token
from app.transactions.detail import view_transaction
from app.transactions.models import PrivilegedTransaction, Transaction
from app.transactions.queries import PUBLIC_TRANSACTION_COLUMNS
from tests.factories import (
    FIRST_ADMIN_ID,
    LOCK_TIMEOUT_MS,
    NOW,
    USER_ID,
    bot_of,
    create_bot,
    create_botless_currency,
    create_currency,
    create_transaction,
    log_in,
)

TRADER_ID = USER_ID
RECEIVING_OWNER_ID = "400000000000000004"
SENDING_OWNER_ID = "500000000000000005"
STRANGER_ID = "700000000000000007"
NEW_OWNER_ID = "800000000000000008"
BOT_REASON = "Farmed oats with an alt account."
SITE_WIDE_REASON = "Sold stolen accounts."
SURVIVING_REASON = "Duped coins in another server."
PUBLIC_KEYS = {
    "id",
    "fromCurrencyId",
    "toCurrencyId",
    "amount",
    "payout",
    "status",
    "submittedAt",
    "handledAt",
    "fromCurrency",
    "toCurrency",
}
PRIVILEGED_KEYS = PUBLIC_KEYS | {"userId"}
EXPLAINED_KEYS = PRIVILEGED_KEYS | {"cause"}
STATUSES = ["Pending", "Completed", "Refunded", "Cancelled", "Reversed"]

Arrival = Callable[[TestClient, psycopg.Connection], None]


class Scene:
    def __init__(self, connection: psycopg.Connection) -> None:
        self.connection = connection
        self.oats = create_currency(connection, "OAT", 1_000_000)
        self.gems = create_currency(connection, "GEM", 1_000_000)
        self.oat_bot = bot_of(connection, self.oats)
        self.gem_bot = bot_of(connection, self.gems)
        self.set_owner(self.oat_bot, RECEIVING_OWNER_ID)
        self.set_owner(self.gem_bot, SENDING_OWNER_ID)

    def trade(self, status: str = "Completed") -> UUID:
        return create_transaction(self.connection, self.gems, self.oats, NOW - timedelta(hours=1), status, TRADER_ID)

    def set_owner(self, bot_id: UUID, owner_id: str) -> None:
        self.connection.execute("UPDATE bots SET owner_id = %s WHERE id = %s", (owner_id, bot_id))

    def block(self, reason: str, bot_id: UUID | None = None, currency_id: UUID | None = None) -> int:
        return self.connection.execute(
            """
            INSERT INTO blocks (user_id, bot_id, currency_id, reason, blocked_by, blocked_at)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (TRADER_ID, bot_id, currency_id, reason, FIRST_ADMIN_ID, NOW - timedelta(hours=2)),
        ).fetchone()["id"]

    def undone_by(self, block_id: int, status: str = "Reversed") -> UUID:
        transaction_id = self.trade(status)
        self.connection.execute("UPDATE transactions SET block_id = %s WHERE id = %s", (block_id, transaction_id))

        return transaction_id

    def traded_by(self, transaction_id: UUID, user_id: str) -> None:
        self.connection.execute("UPDATE transactions SET user_id = %s WHERE id = %s", (user_id, transaction_id))

    def lift(self, block_id: int) -> None:
        self.connection.execute(
            "UPDATE blocks SET unblocked_by = %s, unblocked_at = %s WHERE id = %s", (FIRST_ADMIN_ID, NOW, block_id)
        )

    def merge(self, closed_id: int, kept_id: int) -> None:
        self.connection.execute("UPDATE blocks SET merged_into = %s WHERE id = %s", (kept_id, closed_id))

    def remove_bot(self, bot_id: UUID) -> None:
        self.connection.execute(
            "UPDATE currencies SET active = false, removed_at = %s WHERE bot_id = %s", (NOW, bot_id)
        )
        self.connection.execute("UPDATE bots SET removed_at = %s WHERE id = %s", (NOW, bot_id))


@pytest.fixture
def scene(client: TestClient, connection: psycopg.Connection) -> Scene:
    return Scene(connection)


def bot_name(connection: psycopg.Connection, bot_id: UUID) -> str:
    return connection.execute("SELECT name FROM bots WHERE id = %s", (bot_id,)).fetchone()["name"]


def view(client: TestClient, transaction_id: UUID | str) -> Response:
    return client.get(f"/transactions/{transaction_id}")


def viewed_body(client: TestClient, transaction_id: UUID) -> dict:
    response = view(client, transaction_id)
    assert response.status_code == 200

    return response.json()


def view_as(client: TestClient, connection: psycopg.Connection, viewer_id: str, transaction_id: UUID) -> dict:
    log_in(client, connection, viewer_id)

    return viewed_body(client, transaction_id)


def expire_session(client: TestClient, connection: psycopg.Connection) -> None:
    token = "expired-session"
    connection.execute("INSERT INTO users (id) VALUES (%s) ON CONFLICT (id) DO NOTHING", (TRADER_ID,))
    connection.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
        (hash_secret(token), TRADER_ID, NOW - timedelta(minutes=1)),
    )
    client.cookies.set(SESSION_COOKIE, token)


def send_invalid_session(client: TestClient, connection: psycopg.Connection) -> None:
    client.cookies.set(SESSION_COOKIE, "not-a-session")


def send_no_session(client: TestClient, connection: psycopg.Connection) -> None:
    client.cookies.clear()


def log_in_stranger(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, STRANGER_ID)


def assert_per_viewer_headers(response: Response) -> None:
    assert response.headers["cache-control"] == "private"
    assert "Cookie" in [value.strip() for value in response.headers["vary"].split(",")]


@pytest.mark.parametrize("status", STATUSES)
def test_anyone_gets_the_public_shape_for_each_status(client: TestClient, scene: Scene, status: str) -> None:
    transaction_id = scene.trade(status)

    body = viewed_body(client, transaction_id)

    assert set(body) == PUBLIC_KEYS
    assert body["id"] == str(transaction_id)
    assert body["status"] == status
    assert (body["handledAt"] is None) == (status == "Pending")
    assert body["fromCurrency"] == {"abbreviation": "GEM", "name": "GEM coin", "removed": False}
    assert body["toCurrency"] == {"abbreviation": "OAT", "name": "OAT coin", "removed": False}
    assert body == client.get("/transactions").json()[0]


def test_a_removed_currency_keeps_its_label_marked_removed(client: TestClient, scene: Scene) -> None:
    transaction_id = scene.trade()
    scene.remove_bot(scene.gem_bot)

    body = viewed_body(client, transaction_id)

    assert body["fromCurrency"] == {"abbreviation": "GEM", "name": "GEM coin", "removed": True}
    assert body["toCurrency"]["removed"] is False


def test_an_unknown_transaction_is_404(client: TestClient, scene: Scene) -> None:
    response = view(client, uuid7())

    assert response.status_code == 404
    assert response.json() == {"status": 404, "message": "No transaction with that ID.", "field": None}


def test_a_malformed_id_is_400_on_the_id_field(client: TestClient, scene: Scene) -> None:
    response = view(client, "not-a-uuid")

    assert response.status_code == 400
    assert response.json()["field"] == "transaction_id"


def test_every_answer_is_private_and_varies_by_cookie(client: TestClient, scene: Scene) -> None:
    found = view(client, scene.trade())
    missing = view(client, uuid7())
    malformed = view(client, "not-a-uuid")

    for response in (found, missing, malformed):
        assert_per_viewer_headers(response)


def test_the_logged_in_answer_is_private_too(client: TestClient, connection: psycopg.Connection, scene: Scene) -> None:
    log_in(client, connection, TRADER_ID)

    assert_per_viewer_headers(view(client, scene.trade()))


def test_pending_still_reaches_the_bot_endpoint(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    pending_id = scene.trade("Pending")
    headers = {"Authorization": f"Bearer {issue_api_token(connection, scene.oat_bot)}"}

    response = client.get("/transactions/pending", headers=headers, params={"currencyId": str(scene.oats)})

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(pending_id)]
    assert response.json()[0]["userId"] == TRADER_ID


def test_the_read_does_not_wait_for_row_locks(client: TestClient, database_url: str, scene: Scene) -> None:
    block_id = scene.block(BOT_REASON, bot_id=scene.oat_bot)
    transaction_id = scene.undone_by(block_id)
    log_in(client, scene.connection, RECEIVING_OWNER_ID)
    owner = User(id=RECEIVING_OWNER_ID, username=None, avatar_hash=None, is_admin=False)

    with psycopg.connect(database_url) as holder, psycopg.connect(database_url, row_factory=dict_row) as reader:
        holder.execute("SELECT 1 FROM transactions WHERE id = %s FOR UPDATE", (transaction_id,))
        holder.execute("SELECT 1 FROM blocks WHERE id = %s FOR UPDATE", (block_id,))
        holder.execute("SELECT 1 FROM currencies FOR UPDATE")
        holder.execute("SELECT 1 FROM bots FOR UPDATE")
        reader.execute(f"SET lock_timeout = '{LOCK_TIMEOUT_MS}ms'")

        viewed = view_transaction(reader, transaction_id, owner)

    assert isinstance(viewed, PrivilegedTransaction)
    assert viewed.cause.reason == BOT_REASON


class RevokingAfterEachStatement:
    def __init__(self, db: psycopg.Connection, revoke: Callable[[], None]) -> None:
        self.db = db
        self.revoke = revoke
        self.statements = 0

    def execute(self, query: str, params: object) -> psycopg.Cursor:
        cursor = self.db.execute(query, params)
        self.statements += 1
        self.revoke()

        return cursor


def revoke_owner(scene: Scene) -> Callable[[], None]:
    return lambda: scene.set_owner(scene.oat_bot, NEW_OWNER_ID)


def revoke_bot(scene: Scene) -> Callable[[], None]:
    return lambda: scene.remove_bot(scene.oat_bot)


def revoke_admin(scene: Scene) -> Callable[[], None]:
    return lambda: scene.connection.execute("UPDATE users SET is_admin = false WHERE id = %s", (FIRST_ADMIN_ID,))


@pytest.mark.parametrize(
    ("viewer_id", "revocation"),
    [(RECEIVING_OWNER_ID, revoke_owner), (RECEIVING_OWNER_ID, revoke_bot), (FIRST_ADMIN_ID, revoke_admin)],
)
def test_privilege_and_private_fields_come_from_one_statement(
    client: TestClient,
    database_url: str,
    scene: Scene,
    viewer_id: str,
    revocation: Callable[[Scene], Callable[[], None]],
) -> None:
    transaction_id = scene.undone_by(scene.block(SITE_WIDE_REASON), "Cancelled")
    log_in(client, scene.connection, viewer_id)
    viewer = User(id=viewer_id, username=None, avatar_hash=None, is_admin=False)

    with psycopg.connect(database_url, row_factory=dict_row) as reader:
        revoking = RevokingAfterEachStatement(reader, revocation(scene))
        decided = view_transaction(revoking, transaction_id, viewer)
        reader.rollback()
        after_revocation = view_transaction(reader, transaction_id, viewer)

    assert revoking.statements == 1
    assert isinstance(decided, PrivilegedTransaction)
    assert type(after_revocation) is Transaction
    assert TRADER_ID not in after_revocation.model_dump_json()
    assert SITE_WIDE_REASON not in after_revocation.model_dump_json()
    assert set(viewed_body(client, transaction_id)) == PUBLIC_KEYS


@pytest.mark.parametrize("arrive", [send_no_session, expire_session, send_invalid_session, log_in_stranger])
def test_unprivileged_viewers_get_only_the_public_shape(
    client: TestClient, connection: psycopg.Connection, scene: Scene, arrive: Arrival
) -> None:
    transaction_id = scene.undone_by(scene.block(BOT_REASON, bot_id=scene.oat_bot))
    arrive(client, connection)

    response = view(client, transaction_id)

    assert response.status_code == 200
    assert set(response.json()) == PUBLIC_KEYS
    assert TRADER_ID not in response.text
    assert BOT_REASON not in response.text


@pytest.mark.parametrize("viewer_id", [TRADER_ID, RECEIVING_OWNER_ID, SENDING_OWNER_ID, FIRST_ADMIN_ID])
def test_privileged_viewers_get_the_user_id(
    client: TestClient, connection: psycopg.Connection, scene: Scene, viewer_id: str
) -> None:
    body = view_as(client, connection, viewer_id, scene.trade())

    assert set(body) == PRIVILEGED_KEYS
    assert body["userId"] == TRADER_ID


def test_a_former_owner_of_a_removed_bot_gets_the_public_shape(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.undone_by(scene.block(BOT_REASON, bot_id=scene.oat_bot))
    scene.remove_bot(scene.oat_bot)

    body = view_as(client, connection, RECEIVING_OWNER_ID, transaction_id)

    assert set(body) == PUBLIC_KEYS


def test_the_owner_of_a_removed_currencys_live_bot_gets_the_public_shape(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.trade()
    connection.execute("UPDATE currencies SET active = false, removed_at = %s WHERE id = %s", (NOW, scene.gems))

    body = view_as(client, connection, SENDING_OWNER_ID, transaction_id)

    assert set(body) == PUBLIC_KEYS


@pytest.mark.parametrize("status", ["Pending", "Completed", "Refunded"])
def test_only_undone_transactions_have_a_cause(
    client: TestClient, connection: psycopg.Connection, scene: Scene, status: str
) -> None:
    body = view_as(client, connection, FIRST_ADMIN_ID, scene.trade(status))

    assert "cause" not in body


def test_the_blocking_bots_owner_reads_the_reason(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.undone_by(scene.block(BOT_REASON, bot_id=scene.oat_bot))

    body = view_as(client, connection, RECEIVING_OWNER_ID, transaction_id)

    assert set(body) == EXPLAINED_KEYS
    assert body["cause"] == {
        "kind": "bot",
        "bot": {"name": bot_name(connection, scene.oat_bot), "removed": False},
        "state": "active",
        "reason": BOT_REASON,
    }


@pytest.mark.parametrize("viewer_id", [SENDING_OWNER_ID, TRADER_ID, FIRST_ADMIN_ID])
def test_a_bot_block_reason_is_only_for_that_bots_owner(
    client: TestClient, connection: psycopg.Connection, scene: Scene, viewer_id: str
) -> None:
    transaction_id = scene.undone_by(scene.block(BOT_REASON, bot_id=scene.oat_bot))

    body = view_as(client, connection, viewer_id, transaction_id)

    assert body["cause"] == {
        "kind": "bot",
        "bot": {"name": bot_name(connection, scene.oat_bot), "removed": False},
        "state": "active",
    }


@pytest.mark.parametrize("viewer_id", [RECEIVING_OWNER_ID, SENDING_OWNER_ID, FIRST_ADMIN_ID])
def test_a_site_wide_reason_is_for_owners_and_admins(
    client: TestClient, connection: psycopg.Connection, scene: Scene, viewer_id: str
) -> None:
    transaction_id = scene.undone_by(scene.block(SITE_WIDE_REASON), "Cancelled")

    body = view_as(client, connection, viewer_id, transaction_id)

    assert body["cause"] == {"kind": "global", "state": "active", "reason": SITE_WIDE_REASON}


def test_a_site_wide_reason_is_not_for_a_trading_user_with_no_other_role(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.undone_by(scene.block(SITE_WIDE_REASON), "Cancelled")

    body = view_as(client, connection, TRADER_ID, transaction_id)

    assert body["cause"] == {"kind": "global", "state": "active"}


@pytest.mark.parametrize("trader_id", [FIRST_ADMIN_ID, SENDING_OWNER_ID])
def test_a_trading_admin_or_side_owner_reads_a_site_wide_reason(
    client: TestClient, connection: psycopg.Connection, scene: Scene, trader_id: str
) -> None:
    transaction_id = scene.undone_by(scene.block(SITE_WIDE_REASON), "Cancelled")
    scene.traded_by(transaction_id, trader_id)

    body = view_as(client, connection, trader_id, transaction_id)

    assert body["userId"] == trader_id
    assert body["cause"]["reason"] == SITE_WIDE_REASON


def test_a_trader_who_owns_an_unrelated_live_bot_reads_a_site_wide_reason(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.undone_by(scene.block(SITE_WIDE_REASON), "Cancelled")
    create_bot(connection, TRADER_ID)

    body = view_as(client, connection, TRADER_ID, transaction_id)

    assert body["cause"]["reason"] == SITE_WIDE_REASON


def test_a_trader_whose_only_bot_is_removed_reads_no_site_wide_reason(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.undone_by(scene.block(SITE_WIDE_REASON), "Cancelled")
    scene.remove_bot(create_bot(connection, TRADER_ID))

    body = view_as(client, connection, TRADER_ID, transaction_id)

    assert body["cause"] == {"kind": "global", "state": "active"}


def test_an_unrelated_bot_owner_who_did_not_trade_gets_the_public_shape(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.undone_by(scene.block(SITE_WIDE_REASON), "Cancelled")
    create_bot(connection, STRANGER_ID)
    log_in(client, connection, STRANGER_ID)

    response = view(client, transaction_id)

    assert set(response.json()) == PUBLIC_KEYS
    assert SITE_WIDE_REASON not in response.text


def test_a_trading_owner_reads_the_reason_of_their_own_bots_block(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.undone_by(scene.block(BOT_REASON, bot_id=scene.oat_bot))
    scene.traded_by(transaction_id, RECEIVING_OWNER_ID)

    body = view_as(client, connection, RECEIVING_OWNER_ID, transaction_id)

    assert body["cause"]["reason"] == BOT_REASON


@pytest.mark.parametrize("trader_id", [FIRST_ADMIN_ID, SENDING_OWNER_ID])
def test_a_trading_admin_or_other_side_owner_gets_no_bot_block_reason(
    client: TestClient, connection: psycopg.Connection, scene: Scene, trader_id: str
) -> None:
    transaction_id = scene.undone_by(scene.block(BOT_REASON, bot_id=scene.oat_bot))
    scene.traded_by(transaction_id, trader_id)

    body = view_as(client, connection, trader_id, transaction_id)

    assert "reason" not in body["cause"]
    assert BOT_REASON not in str(body)


def test_the_reason_stays_after_the_block_is_lifted(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    block_id = scene.block(BOT_REASON, bot_id=scene.oat_bot)
    transaction_id = scene.undone_by(block_id)
    scene.lift(block_id)

    body = view_as(client, connection, RECEIVING_OWNER_ID, transaction_id)

    assert body["cause"]["state"] == "lifted"
    assert body["cause"]["reason"] == BOT_REASON


def test_ownership_is_judged_now(client: TestClient, connection: psycopg.Connection, scene: Scene) -> None:
    transaction_id = scene.undone_by(scene.block(BOT_REASON, bot_id=scene.oat_bot))
    scene.set_owner(scene.oat_bot, NEW_OWNER_ID)

    new_owner_view = view_as(client, connection, NEW_OWNER_ID, transaction_id)
    previous_owner_view = view_as(client, connection, RECEIVING_OWNER_ID, transaction_id)

    assert new_owner_view["cause"]["reason"] == BOT_REASON
    assert set(previous_owner_view) == PUBLIC_KEYS


def test_a_merged_block_shows_its_own_reason(client: TestClient, connection: psycopg.Connection, scene: Scene) -> None:
    merged_id = scene.block(BOT_REASON, bot_id=scene.oat_bot)
    transaction_id = scene.undone_by(merged_id)
    scene.lift(merged_id)
    scene.merge(merged_id, scene.block(SURVIVING_REASON, bot_id=scene.oat_bot))

    body = view_as(client, connection, RECEIVING_OWNER_ID, transaction_id)

    assert body["cause"]["state"] == "merged"
    assert body["cause"]["reason"] == BOT_REASON
    assert SURVIVING_REASON not in str(body)


def test_a_currency_block_moved_to_a_bot_names_that_bot(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    barley = create_botless_currency(connection, "BRL", 1_000_000)
    transaction_id = create_transaction(connection, barley, scene.oats, NOW - timedelta(hours=1), "Reversed", TRADER_ID)
    block_id = scene.block(BOT_REASON, currency_id=barley)
    connection.execute("UPDATE transactions SET block_id = %s WHERE id = %s", (block_id, transaction_id))
    log_in(client, connection, FIRST_ADMIN_ID)
    assigned = client.patch(f"/admin/currencies/{barley}", json={"botId": str(scene.gem_bot)})
    assert assigned.status_code == 200

    body = view_as(client, connection, SENDING_OWNER_ID, transaction_id)

    assert body["cause"] == {
        "kind": "bot",
        "bot": {"name": bot_name(connection, scene.gem_bot), "removed": False},
        "state": "active",
        "reason": BOT_REASON,
    }


def test_a_lifted_currency_block_is_scoped_to_the_currencys_current_bot(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    block_id = scene.block(BOT_REASON, currency_id=scene.oats)
    transaction_id = scene.undone_by(block_id)
    scene.lift(block_id)

    body = view_as(client, connection, RECEIVING_OWNER_ID, transaction_id)

    assert body["cause"]["kind"] == "bot"
    assert body["cause"]["bot"]["name"] == bot_name(connection, scene.oat_bot)
    assert body["cause"]["reason"] == BOT_REASON


def test_a_currency_block_on_a_botless_currency_has_no_scope_and_fails(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    barley = create_botless_currency(connection, "BRL", 1_000_000)
    transaction_id = create_transaction(connection, barley, scene.oats, NOW - timedelta(hours=1), "Reversed", TRADER_ID)
    block_id = scene.block(BOT_REASON, currency_id=barley)
    connection.execute("UPDATE transactions SET block_id = %s WHERE id = %s", (block_id, transaction_id))
    log_in(client, connection, FIRST_ADMIN_ID)

    with pytest.raises(RuntimeError, match="no bot"):
        view(client, transaction_id)

    failing = TestClient(client.app, base_url=str(client.base_url), raise_server_exceptions=False)
    failing.cookies = client.cookies
    response = view(failing, transaction_id)

    assert response.status_code == 500
    assert_per_viewer_headers(response)


@pytest.mark.parametrize("viewer_id", [SENDING_OWNER_ID, FIRST_ADMIN_ID])
def test_a_removed_blocking_bot_is_marked_and_its_reason_is_for_nobody(
    client: TestClient, connection: psycopg.Connection, scene: Scene, viewer_id: str
) -> None:
    transaction_id = scene.undone_by(scene.block(BOT_REASON, bot_id=scene.oat_bot))
    scene.remove_bot(scene.oat_bot)

    body = view_as(client, connection, viewer_id, transaction_id)

    assert body["cause"] == {
        "kind": "bot",
        "bot": {"name": bot_name(connection, scene.oat_bot), "removed": True},
        "state": "active",
    }


def test_a_cancel_without_a_block_says_so(client: TestClient, connection: psycopg.Connection, scene: Scene) -> None:
    body = view_as(client, connection, FIRST_ADMIN_ID, scene.trade("Cancelled"))

    assert body["cause"] == {"kind": "none"}


def test_an_owner_block_through_the_api_explains_the_reversal(
    client: TestClient, connection: psycopg.Connection, scene: Scene
) -> None:
    transaction_id = scene.trade()
    log_in(client, connection, RECEIVING_OWNER_ID)
    blocked = client.post(
        f"/bots/{scene.oat_bot}/blocks",
        json={"userId": TRADER_ID, "reason": BOT_REASON, "reverse": {"window": "all", "direction": "incoming"}},
    )
    assert blocked.status_code == 201

    body = viewed_body(client, transaction_id)

    assert body["status"] == "Reversed"
    assert body["cause"]["reason"] == BOT_REASON


def test_the_public_column_list_has_no_user_id() -> None:
    assert "user_id" not in PUBLIC_TRANSACTION_COLUMNS


def test_public_lists_carry_no_user_id(client: TestClient, connection: psycopg.Connection, scene: Scene) -> None:
    scene.trade()
    log_in(client, connection, TRADER_ID)

    for path in ("/transactions", f"/currencies/{scene.oats}/transactions", "/me/transactions"):
        response = client.get(path)

        assert response.status_code == 200, path
        assert [set(item) for item in response.json()] == [PUBLIC_KEYS], path
        assert TRADER_ID not in response.text, path
