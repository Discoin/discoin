from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

import app.blocking.service
from app.transactions.ledger import create_transaction
from tests.factories import FIRST_ADMIN_ID, NOW, OWNER_ID, USER_ID, create_currency, log_in

OTHER_OWNER_ID = "600000000000000006"


class Market:
    def __init__(self, connection: psycopg.Connection) -> None:
        self.connection = connection
        self.oats = create_currency(connection, "OAT", 1_000_000)
        self.gems = create_currency(connection, "GEM", 1_000_000)
        self.pebbles = create_currency(connection, "PBL", 1_000_000)
        connection.execute("UPDATE currencies SET owner_id = %s WHERE id <> %s", (OTHER_OWNER_ID, self.oats))

    def convert(
        self, source: UUID, target: UUID, at: datetime, status: str = "Completed", user_id: str = USER_ID
    ) -> str:
        created = create_transaction(self.connection, user_id, source, target, Decimal(1000), at)
        if status != "Pending":
            self.connection.execute(
                "UPDATE transactions SET status = %s, handled_at = %s WHERE id = %s", (status, at, created["id"])
            )

        return str(created["id"])

    def status(self, transaction_id: str) -> str:
        return self.connection.execute("SELECT status FROM transactions WHERE id = %s", (transaction_id,)).fetchone()[
            "status"
        ]

    def reserve(self, currency_id: UUID) -> Decimal:
        return self.connection.execute("SELECT reserve FROM currencies WHERE id = %s", (currency_id,)).fetchone()[
            "reserve"
        ]


@pytest.fixture
def market(client: TestClient, connection: psycopg.Connection) -> Market:
    return Market(connection)


def block_body(reason: str = "Duping coins", **reverse: str) -> dict:
    body: dict = {"userId": USER_ID, "reason": reason}
    if reverse:
        body["reverse"] = reverse

    return body


def as_owner(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, OWNER_ID)


def as_admin(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, FIRST_ADMIN_ID)


def test_owner_block_lists_with_admin_blocks_read_only(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    as_admin(client, connection)
    client.post("/admin/blocks", json={"userId": "700000000000000007", "reason": "Scam"})
    as_owner(client, connection)

    created = client.post(f"/currencies/{market.oats}/blocks", json=block_body())
    listed = client.get(f"/currencies/{market.oats}/blocks").json()

    assert created.status_code == 201
    assert created.json()["blocked"] == {
        "userId": USER_ID,
        "reason": "Duping coins",
        "blockedAt": "2026-11-13T12:00:00Z",
        "level": "currency",
    }
    assert [(row["userId"], row["level"]) for row in listed] == [
        (USER_ID, "currency"),
        ("700000000000000007", "global"),
    ]


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"userId": "123", "reason": "Spam"}, "userId"),
        ({"userId": USER_ID, "reason": "   "}, "reason"),
        ({"userId": USER_ID}, "reason"),
    ],
)
def test_block_needs_a_user_and_a_reason(
    client: TestClient, connection: psycopg.Connection, market: Market, body: dict, field: str
) -> None:
    as_owner(client, connection)

    response = client.post(f"/currencies/{market.oats}/blocks", json=body)

    assert (response.status_code, response.json()["field"]) == (400, field)


def test_owner_cannot_block_a_user_admins_blocked(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    as_admin(client, connection)
    client.post("/admin/blocks", json=block_body())
    as_owner(client, connection)

    response = client.post(f"/currencies/{market.oats}/blocks", json=block_body())

    assert response.json() == {"status": 400, "message": "Already blocked by Discoin admins.", "field": "userId"}


def test_blocking_twice_is_a_conflict(client: TestClient, connection: psycopg.Connection, market: Market) -> None:
    as_owner(client, connection)
    client.post(f"/currencies/{market.oats}/blocks", json=block_body())

    response = client.post(f"/currencies/{market.oats}/blocks", json=block_body())

    assert (response.status_code, response.json()["field"]) == (409, "userId")


def test_owner_block_cancels_pending_for_that_currency_only(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    into_oats = market.convert(market.gems, market.oats, NOW - timedelta(hours=1), status="Pending")
    elsewhere = market.convert(market.gems, market.pebbles, NOW - timedelta(hours=1), status="Pending")
    as_owner(client, connection)

    response = client.post(f"/currencies/{market.oats}/blocks", json=block_body())

    assert response.json()["reversed"] == []
    assert market.status(into_oats) == "Cancelled"
    assert market.status(elsewhere) == "Pending"


def test_cancel_runs_back_through_the_curve(client: TestClient, connection: psycopg.Connection, market: Market) -> None:
    market.convert(market.gems, market.oats, NOW - timedelta(hours=1), status="Pending")
    as_owner(client, connection)

    client.post(f"/currencies/{market.oats}/blocks", json=block_body())

    assert market.reserve(market.oats) == Decimal(1_000_000)
    assert market.reserve(market.gems) == Decimal("1000000.01")


@pytest.mark.parametrize(
    ("direction", "expected"),
    [("incoming", ["recent_in"]), ("outgoing", ["recent_out"]), ("both", ["recent_in", "recent_out"])],
)
def test_owner_reverses_completed_by_direction_and_window(
    client: TestClient, connection: psycopg.Connection, market: Market, direction: str, expected: list[str]
) -> None:
    transactions = {
        "old_in": market.convert(market.gems, market.oats, NOW - timedelta(days=8)),
        "recent_out": market.convert(market.oats, market.pebbles, NOW - timedelta(days=2)),
        "recent_in": market.convert(market.gems, market.oats, NOW - timedelta(days=1)),
        "unrelated": market.convert(market.gems, market.pebbles, NOW - timedelta(hours=1)),
    }
    as_owner(client, connection)

    response = client.post(f"/currencies/{market.oats}/blocks", json=block_body(window="7d", direction=direction))

    reversed_ids = [transaction["id"] for transaction in response.json()["reversed"]]
    assert reversed_ids == [transactions[name] for name in expected]
    assert all(market.status(transactions[name]) == "Reversed" for name in expected)
    assert market.status(transactions["old_in"]) == "Completed"
    assert market.status(transactions["unrelated"]) == "Completed"


def test_owner_reversal_needs_a_direction(client: TestClient, connection: psycopg.Connection, market: Market) -> None:
    as_owner(client, connection)

    response = client.post(f"/currencies/{market.oats}/blocks", json=block_body(window="24h"))

    assert (response.status_code, response.json()["field"]) == (400, "direction")


def test_admin_reversal_takes_no_direction(client: TestClient, connection: psycopg.Connection, market: Market) -> None:
    as_admin(client, connection)

    response = client.post("/admin/blocks", json=block_body(window="24h", direction="both"))

    assert (response.status_code, response.json()["field"]) == (400, "direction")


def test_admin_block_cancels_and_reverses_everywhere(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    pending = market.convert(market.gems, market.pebbles, NOW - timedelta(hours=3), status="Pending")
    completed = market.convert(market.pebbles, market.oats, NOW - timedelta(days=20))
    refunded = market.convert(market.pebbles, market.oats, NOW - timedelta(days=2), status="Refunded")
    someone_else = market.convert(market.gems, market.oats, NOW, user_id="800000000000000008")
    as_admin(client, connection)

    response = client.post("/admin/blocks", json=block_body(window="all"))

    assert [transaction["id"] for transaction in response.json()["reversed"]] == [completed]
    assert response.json()["blocked"]["level"] == "global"
    assert market.status(pending) == "Cancelled"
    assert market.status(refunded) == "Refunded"
    assert market.status(someone_else) == "Completed"


def test_block_webhooks_say_who_triggered_them(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    connection.execute(
        "UPDATE currencies SET webhook_url = 'https://bot.example.com', webhook_secret_sealed = 'v1.unused'"
    )
    market.convert(market.gems, market.oats, NOW - timedelta(hours=1))
    market.convert(market.oats, market.gems, NOW - timedelta(hours=2), status="Pending")
    connection.execute("DELETE FROM webhook_deliveries")
    as_owner(client, connection)

    client.post(f"/currencies/{market.oats}/blocks", json=block_body(window="24h", direction="both"))

    deliveries = connection.execute("SELECT event, currency_id, payload FROM webhook_deliveries ORDER BY id").fetchall()
    assert [(row["event"], row["currency_id"]) for row in deliveries] == [
        ("reversed", market.oats),
        ("cancelled", market.gems),
    ]
    assert all(row["payload"]["triggeredBy"] == {"kind": "owner", "currencyId": str(market.oats)} for row in deliveries)


def test_preview_lists_reversals_without_saving(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    completed = market.convert(market.gems, market.oats, NOW - timedelta(hours=1))
    as_owner(client, connection)

    preview = client.post(
        f"/currencies/{market.oats}/blocks/preview", json=block_body(window="24h", direction="incoming")
    )

    assert [transaction["id"] for transaction in preview.json()] == [completed]
    assert market.status(completed) == "Completed"
    assert client.get(f"/currencies/{market.oats}/blocks").json() == []


def test_block_is_all_or_nothing(
    client: TestClient, connection: psycopg.Connection, market: Market, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = market.convert(market.gems, market.oats, NOW - timedelta(hours=1))
    second = market.convert(market.gems, market.oats, NOW - timedelta(hours=2))
    reserve_before = market.reserve(market.oats)
    real_undo = app.blocking.service.undo_transaction
    calls = []

    def fail_second_undo(*arguments: object) -> dict:
        calls.append(arguments)
        if len(calls) == 2:
            raise RuntimeError("undo failed")

        return real_undo(*arguments)

    monkeypatch.setattr(app.blocking.service, "undo_transaction", fail_second_undo)
    as_owner(client, connection)

    with pytest.raises(RuntimeError, match="undo failed"):
        client.post(f"/currencies/{market.oats}/blocks", json=block_body(window="24h", direction="incoming"))

    assert (market.status(first), market.status(second)) == ("Completed", "Completed")
    assert connection.execute("SELECT count(*) AS blocks FROM blocks").fetchone()["blocks"] == 0
    assert market.reserve(market.oats) == reserve_before


def test_unblock_keeps_the_record_and_allows_a_new_block(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    as_owner(client, connection)
    client.post(f"/currencies/{market.oats}/blocks", json=block_body())

    unblocked = client.delete(f"/currencies/{market.oats}/blocks/{USER_ID}")
    listed = client.get(f"/currencies/{market.oats}/blocks").json()
    blocked_again = client.post(f"/currencies/{market.oats}/blocks", json=block_body("Again"))

    record = connection.execute("SELECT unblocked_by, unblocked_at FROM blocks ORDER BY id LIMIT 1").fetchone()
    assert unblocked.status_code == 204
    assert listed == []
    assert record == {"unblocked_by": OWNER_ID, "unblocked_at": NOW}
    assert blocked_again.status_code == 201


def test_owner_cannot_remove_an_admin_block(client: TestClient, connection: psycopg.Connection, market: Market) -> None:
    as_admin(client, connection)
    client.post("/admin/blocks", json=block_body())
    as_owner(client, connection)

    assert client.delete(f"/currencies/{market.oats}/blocks/{USER_ID}").status_code == 403


def test_unblocking_someone_not_blocked_is_404(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    as_owner(client, connection)

    assert client.delete(f"/currencies/{market.oats}/blocks/{USER_ID}").status_code == 404


def test_admin_unblocks_everywhere(client: TestClient, connection: psycopg.Connection, market: Market) -> None:
    as_admin(client, connection)
    client.post("/admin/blocks", json=block_body())

    assert client.delete(f"/admin/blocks/{USER_ID}").status_code == 204
    assert client.get("/admin/blocks").json() == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/admin/blocks"),
        ("POST", "/admin/blocks"),
        ("POST", "/admin/blocks/preview"),
        ("DELETE", "/admin/blocks/1"),
    ],
)
def test_admin_block_routes_are_for_admins(
    client: TestClient, connection: psycopg.Connection, market: Market, method: str, path: str
) -> None:
    as_owner(client, connection)

    assert client.request(method, path, json=block_body(window="all")).status_code == 403


def test_only_the_owner_manages_currency_blocks(
    client: TestClient, connection: psycopg.Connection, market: Market
) -> None:
    as_admin(client, connection)

    assert client.post(f"/currencies/{market.oats}/blocks", json=block_body()).status_code == 403
