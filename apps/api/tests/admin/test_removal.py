import json
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

import app.admin.deactivation
from app.admin.removal import preview_bot_removal, preview_currency_removal
from app.bots.tokens import issue_api_token
from app.core.errors import ApiError
from app.currencies.queries import record_history
from app.transactions.ledger import create_transaction
from app.webhooks.delivery import deliver_due_webhooks, enqueue_webhook
from tests.factories import (
    FIRST_ADMIN_ID,
    LOCK_TIMEOUT_MS,
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
from tests.webhooks.receiver import Receiver, connect_webhook


class Market:
    def __init__(self, client: TestClient, connection: psycopg.Connection) -> None:
        self.client = client
        self.connection = connection
        self.oats = create_currency(connection, "OAT", 1_000_000)
        self.gems = create_currency(connection, "GEM", 1_000_000)
        self.pebbles = create_botless_currency(connection, "PBL", 1_000_000)
        self.oat_bot = bot_of(connection, self.oats)
        self.gem_bot = bot_of(connection, self.gems)
        log_in(client, connection, FIRST_ADMIN_ID)

    def convert(self, source: UUID, target: UUID) -> UUID:
        return create_transaction(self.connection, USER_ID, source, target, Decimal(1000), NOW)["id"]

    def remove_currency(self, currency_id: UUID) -> int:
        return self.client.delete(f"/admin/currencies/{currency_id}").status_code

    def remove_bot(self, bot_id: UUID) -> int:
        return self.client.delete(f"/admin/bots/{bot_id}").status_code

    def status(self, transaction_id: UUID) -> str:
        row = self.connection.execute("SELECT status FROM transactions WHERE id = %s", (transaction_id,)).fetchone()

        return row["status"]

    def reserve(self, currency_id: UUID) -> Decimal:
        row = self.connection.execute("SELECT reserve FROM currencies WHERE id = %s", (currency_id,)).fetchone()

        return row["reserve"]

    def deliveries(self) -> list[dict]:
        return self.connection.execute(
            "SELECT event, currency_id, state, last_error FROM webhook_deliveries ORDER BY id"
        ).fetchall()


@pytest.fixture
def market(client: TestClient, connection: psycopg.Connection) -> Market:
    return Market(client, connection)


def add_currency(client: TestClient, bot_id: UUID, abbreviation: str) -> dict:
    body = {"name": "New oats", "abbreviation": abbreviation, "weeklyMedian": 25_000, "multiplier": 4}
    response = client.post("/admin/currencies", json={**body, "botId": str(bot_id)})

    return {"http": response.status_code, **response.json()}


def test_removing_a_currency_marks_it_removed_and_inactive(market: Market) -> None:
    assert market.remove_currency(market.oats) == 204

    row = market.connection.execute("SELECT active, removed_at FROM currencies WHERE id = %s", (market.oats,))
    assert row.fetchone() == {"active": False, "removed_at": NOW}


def test_removing_a_currency_cancels_its_pending(market: Market) -> None:
    into = market.convert(market.gems, market.oats)
    out_of = market.convert(market.oats, market.gems)
    elsewhere = market.convert(market.gems, market.pebbles)

    market.remove_currency(market.oats)

    statuses = (market.status(into), market.status(out_of), market.status(elsewhere))
    assert statuses == ("Cancelled", "Cancelled", "Pending")


def test_removing_a_currency_refunds_through_the_curve(market: Market) -> None:
    market.convert(market.gems, market.oats)

    market.remove_currency(market.oats)

    assert market.reserve(market.gems) == Decimal("1000000.01")


def test_removing_a_currency_alone_keeps_the_bot_and_its_other_currencies(market: Market) -> None:
    market.connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (market.oat_bot, market.pebbles))
    token = issue_api_token(market.connection, market.oat_bot)

    market.remove_currency(market.oats)

    pending = market.client.get(
        "/transactions/pending",
        params={"currencyId": str(market.pebbles)},
        headers={"Authorization": f"Bearer {token}"},
    )
    bot = market.connection.execute("SELECT removed_at FROM bots WHERE id = %s", (market.oat_bot,)).fetchone()
    assert bot == {"removed_at": None}
    assert pending.status_code == 200
    assert [currency["abbreviation"] for currency in market.client.get("/currencies").json()] == ["GEM", "PBL"]


def test_currency_removal_delivers_cancel_webhooks_and_what_was_queued(market: Market) -> None:
    connect_webhook(market.connection, market.oats)
    connect_webhook(market.connection, market.gems)
    market.convert(market.gems, market.oats)
    market.convert(market.oats, market.gems)

    market.remove_currency(market.oats)

    sent = market.connection.execute(
        """
        SELECT d.event, d.currency_id FROM webhook_deliveries d
        JOIN currencies c ON c.id = d.currency_id JOIN bots b ON b.id = c.bot_id
        WHERE d.state = 'pending' AND b.webhook_url IS NOT NULL
        ORDER BY d.id
        """
    ).fetchall()
    assert sorted((row["event"], str(row["currency_id"])) for row in sent) == sorted(
        [
            ("created", str(market.oats)),
            ("created", str(market.gems)),
            ("cancelled", str(market.oats)),
            ("cancelled", str(market.gems)),
        ]
    )


def test_removing_a_bot_removes_its_currencies_and_cancels_their_pending(market: Market) -> None:
    market.connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (market.oat_bot, market.pebbles))
    first = market.convert(market.gems, market.oats)
    second = market.convert(market.pebbles, market.gems)

    assert market.remove_bot(market.oat_bot) == 204

    removed = market.connection.execute("SELECT abbreviation FROM currencies WHERE removed_at IS NOT NULL ORDER BY 1")
    bot = market.connection.execute("SELECT removed_at FROM bots WHERE id = %s", (market.oat_bot,)).fetchone()
    assert [row["abbreviation"] for row in removed.fetchall()] == ["OAT", "PBL"]
    assert (market.status(first), market.status(second)) == ("Cancelled", "Cancelled")
    assert bot == {"removed_at": NOW}


def test_removing_a_bot_with_no_currencies(market: Market) -> None:
    lonely = create_bot(market.connection)

    assert market.remove_bot(lonely) == 204


def test_removing_a_botless_currency(market: Market) -> None:
    assert market.remove_currency(market.pebbles) == 204


def test_bot_removal_kills_the_token_and_clears_the_webhook(market: Market) -> None:
    token = issue_api_token(market.connection, market.oat_bot)
    connect_webhook(market.connection, market.oats)

    market.remove_bot(market.oat_bot)

    stored = market.connection.execute(
        "SELECT api_token_hash, webhook_url, webhook_secret_sealed FROM bots WHERE id = %s", (market.oat_bot,)
    ).fetchone()
    pending = market.client.get(
        "/transactions/pending", params={"currencyId": str(market.oats)}, headers={"Authorization": f"Bearer {token}"}
    )
    assert stored == {"api_token_hash": None, "webhook_url": None, "webhook_secret_sealed": None}
    assert pending.status_code == 401


def test_bot_removal_drops_its_webhooks_and_notifies_other_bots(market: Market) -> None:
    connect_webhook(market.connection, market.oats)
    connect_webhook(market.connection, market.gems)
    market.convert(market.gems, market.oats)
    market.convert(market.oats, market.gems)

    market.remove_bot(market.oat_bot)

    assert [(row["event"], row["currency_id"], row["state"]) for row in market.deliveries()] == [
        ("created", market.oats, "dropped"),
        ("created", market.gems, "pending"),
        ("cancelled", market.gems, "pending"),
    ]
    assert market.deliveries()[0]["last_error"] == "The bot was removed."


def sent_events(receiver: Receiver) -> list[str]:
    return [json.loads(request.content)["event"] for request in receiver.requests]


def test_currency_removal_sends_the_queued_and_cancel_webhooks(market: Market) -> None:
    connect_webhook(market.connection, market.oats)
    market.convert(market.gems, market.oats)
    market.remove_currency(market.oats)
    receiver = Receiver([200])

    deliver_due_webhooks(market.connection, receiver.sender(), NOW)

    assert sent_events(receiver) == ["transaction.created", "transaction.cancelled"]


def test_bot_removal_sends_nothing_to_its_webhook(market: Market) -> None:
    connect_webhook(market.connection, market.oats)
    market.convert(market.gems, market.oats)
    market.remove_bot(market.oat_bot)
    receiver = Receiver([200])

    deliver_due_webhooks(market.connection, receiver.sender(), NOW)

    assert receiver.requests == []


@pytest.mark.parametrize("target", ["currency", "bot"])
def test_removal_is_all_or_nothing(market: Market, monkeypatch: pytest.MonkeyPatch, target: str) -> None:
    first = market.convert(market.gems, market.oats)
    second = market.convert(market.gems, market.oats)
    before = market.reserve(market.oats)
    real_undo = app.admin.deactivation.undo_transaction
    calls = []

    def fail_second_undo(*arguments: object) -> dict:
        calls.append(arguments)

        if len(calls) == 2:
            raise RuntimeError("undo failed")

        return real_undo(*arguments)

    monkeypatch.setattr(app.admin.deactivation, "undo_transaction", fail_second_undo)

    with pytest.raises(RuntimeError, match="undo failed"):
        market.client.delete(
            f"/admin/currencies/{market.oats}" if target == "currency" else f"/admin/bots/{market.oat_bot}"
        )

    stored = market.connection.execute("SELECT active, removed_at FROM currencies WHERE id = %s", (market.oats,))
    bot = market.connection.execute("SELECT removed_at FROM bots WHERE id = %s", (market.oat_bot,)).fetchone()
    assert (market.status(first), market.status(second)) == ("Pending", "Pending")
    assert stored.fetchone() == {"active": True, "removed_at": None}
    assert bot == {"removed_at": None}
    assert market.reserve(market.oats) == before


def test_currency_removal_preview_counts_what_happens(market: Market) -> None:
    market.convert(market.gems, market.oats)
    market.convert(market.oats, market.gems)
    market.convert(market.gems, market.pebbles)

    preview = market.client.get(f"/admin/currencies/{market.oats}/removal").json()

    assert preview == {
        "currencies": [{"id": str(market.oats), "abbreviation": "OAT", "name": "OAT coin"}],
        "pendingTransactions": 2,
        "enforcedBlocks": 0,
    }


def test_removal_previews_do_not_wait_for_row_locks(market: Market, database_url: str) -> None:
    with psycopg.connect(database_url) as holder, psycopg.connect(database_url, row_factory=dict_row) as reader:
        holder.execute("SELECT 1 FROM currencies FOR UPDATE")
        holder.execute("SELECT 1 FROM bots FOR UPDATE")
        reader.execute(f"SET lock_timeout = '{LOCK_TIMEOUT_MS}ms'")

        currency = preview_currency_removal(reader, market.oats)
        bot = preview_bot_removal(reader, market.oat_bot)

    assert (currency.pending_transactions, len(bot.currencies)) == (0, 1)


def test_botless_currency_preview_counts_its_own_blocks(market: Market) -> None:
    market.connection.execute(
        "INSERT INTO blocks (user_id, currency_id, reason, blocked_by, blocked_at) VALUES (%s, %s, 'Spam', %s, %s)",
        (USER_ID, market.pebbles, OWNER_ID, NOW),
    )

    preview = market.client.get(f"/admin/currencies/{market.pebbles}/removal").json()

    assert preview["enforcedBlocks"] == 1


def test_bot_removal_preview_counts_currencies_pending_and_blocks(market: Market) -> None:
    market.connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (market.oat_bot, market.pebbles))
    market.convert(market.gems, market.oats)
    market.convert(market.pebbles, market.oats)
    market.convert(market.gems, market.pebbles)
    market.connection.execute(
        "INSERT INTO blocks (user_id, bot_id, reason, blocked_by, blocked_at) VALUES (%s, %s, 'Spam', %s, %s)",
        (USER_ID, market.oat_bot, OWNER_ID, NOW),
    )

    preview = market.client.get(f"/admin/bots/{market.oat_bot}/removal").json()

    assert preview == {
        "currencies": [
            {"id": str(market.oats), "abbreviation": "OAT", "name": "OAT coin"},
            {"id": str(market.pebbles), "abbreviation": "PBL", "name": "PBL coin"},
        ],
        "pendingTransactions": 3,
        "enforcedBlocks": 1,
    }


def test_removed_bot_blocks_stay_as_history(market: Market) -> None:
    market.connection.execute(
        "INSERT INTO blocks (user_id, bot_id, reason, blocked_by, blocked_at) VALUES (%s, %s, 'Spam', %s, %s)",
        (USER_ID, market.oat_bot, OWNER_ID, NOW),
    )

    market.remove_bot(market.oat_bot)

    block = market.connection.execute("SELECT bot_id, unblocked_at FROM blocks").fetchone()
    assert block == {"bot_id": market.oat_bot, "unblocked_at": None}


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", "/admin/currencies/{oats}", {"weeklyMedian": 10}),
        ("PATCH", "/admin/currencies/{oats}", {"active": True}),
        ("PATCH", "/admin/currencies/{oats}", {"botId": "{gem_bot}"}),
        ("DELETE", "/admin/currencies/{oats}", None),
        ("GET", "/admin/currencies/{oats}/removal", None),
    ],
)
def test_a_removed_currency_cannot_be_edited_restored_or_removed_again(
    market: Market, method: str, path: str, body: dict | None
) -> None:
    market.remove_currency(market.oats)
    ids = {"oats": market.oats, "gem_bot": market.gem_bot}
    sent = None if body is None else {key: str(value).format(**ids) for key, value in body.items()}

    response = market.client.request(method, path.format(**ids), json=sent)

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", "/admin/bots/{bot}", {"name": "Back"}),
        ("DELETE", "/admin/bots/{bot}", None),
        ("GET", "/admin/bots/{bot}/removal", None),
    ],
)
def test_a_removed_bot_cannot_be_edited_or_removed_again(
    market: Market, method: str, path: str, body: dict | None
) -> None:
    market.remove_bot(market.oat_bot)

    assert market.client.request(method, path.format(bot=market.oat_bot), json=body).status_code == 404


@pytest.mark.parametrize("path", ["/admin/currencies/{oats}/restore", "/admin/bots/{bot}/restore"])
def test_there_is_no_restore_route(market: Market, path: str) -> None:
    market.remove_bot(market.oat_bot)

    response = market.client.post(path.format(oats=market.oats, bot=market.oat_bot))

    assert response.status_code == 404


def test_removal_is_for_admins(market: Market) -> None:
    log_in(market.client, market.connection, OWNER_ID)

    assert market.remove_currency(market.oats) == 403
    assert market.remove_bot(market.oat_bot) == 403


def test_abbreviation_is_free_again_after_removal(market: Market) -> None:
    market.remove_currency(market.oats)

    added = add_currency(market.client, market.gem_bot, "OAT")

    assert added["http"] == 201
    assert market.client.get("/currencies/OAT").json()["id"] == added["currency"]["id"]


def test_owner_can_rename_into_a_removed_abbreviation(market: Market) -> None:
    market.remove_currency(market.oats)
    log_in(market.client, market.connection, OWNER_ID)

    response = market.client.patch(f"/currencies/{market.gems}", json={"name": "Oats", "abbreviation": "OAT"})

    assert (response.status_code, response.json()["abbreviation"]) == (200, "OAT")


def test_bot_discord_id_is_free_again_after_removal(market: Market) -> None:
    row = market.connection.execute("SELECT discord_id FROM bots WHERE id = %s", (market.oat_bot,)).fetchone()
    discord_id = row["discord_id"]
    market.remove_bot(market.oat_bot)

    response = market.client.post("/admin/bots", json={"name": "Again", "discordId": discord_id, "ownerId": OWNER_ID})

    assert response.status_code == 201


def test_racing_abbreviation_is_a_field_error(market: Market) -> None:
    with patch("app.currencies.queries.abbreviation_in_use", return_value=False):
        added = add_currency(market.client, market.gem_bot, "OAT")

    assert (added["http"], added["field"]) == (409, "abbreviation")


def test_racing_rename_is_a_field_error(market: Market) -> None:
    log_in(market.client, market.connection, OWNER_ID)

    with patch("app.currencies.queries.abbreviation_in_use", return_value=False):
        response = market.client.patch(f"/currencies/{market.gems}", json={"name": "Oats", "abbreviation": "OAT"})

    assert (response.status_code, response.json()["field"]) == (409, "abbreviation")


def test_history_tells_a_removed_currency_from_its_reused_abbreviation(market: Market) -> None:
    old = market.convert(market.gems, market.oats)
    market.connection.execute("UPDATE transactions SET status = 'Completed', handled_at = %s", (NOW,))
    market.remove_currency(market.oats)
    new_oats = UUID(add_currency(market.client, market.oat_bot, "OAT")["currency"]["id"])
    new = market.convert(market.gems, new_oats)

    feed = {row["id"]: row["toCurrency"] for row in market.client.get("/transactions").json()}

    assert feed[str(old)] == {"abbreviation": "OAT", "name": "OAT coin", "removed": True}
    assert feed[str(new)] == {"abbreviation": "OAT", "name": "New oats", "removed": False}


def test_leak_1_public_and_admin_lists_leave_out_removed_currencies(market: Market) -> None:
    market.remove_currency(market.oats)

    active = [row["abbreviation"] for row in market.client.get("/currencies").json()]
    every = [row["abbreviation"] for row in market.client.get("/currencies", params={"includeInactive": True}).json()]
    admin = [row["currency"]["abbreviation"] for row in market.client.get("/admin/currencies").json()]
    assert active == ["GEM", "PBL"]
    assert every == ["GEM", "PBL"]
    assert admin == ["GEM", "PBL"]


def test_leak_2_abbreviation_lookup_finds_only_the_live_currency(market: Market) -> None:
    market.remove_currency(market.oats)

    assert market.client.get("/currencies/OAT").status_code == 404

    added = add_currency(market.client, market.gem_bot, "OAT")
    assert market.client.get("/currencies/oat").json()["id"] == added["currency"]["id"]


def test_leak_3_history_of_a_removed_currency_is_404(market: Market) -> None:
    market.remove_currency(market.oats)

    assert market.client.get(f"/currencies/{market.oats}/history", params={"days": 7}).status_code == 404


def test_leak_4_history_is_not_recorded_for_a_removed_currency(market: Market) -> None:
    market.remove_currency(market.oats)
    before = market.connection.execute("SELECT count(*) AS points FROM currency_history").fetchone()

    record_history(market.connection, market.oats, Decimal(5), NOW + timedelta(hours=1))

    after = market.connection.execute("SELECT count(*) AS points FROM currency_history").fetchone()
    assert after == before


def test_leak_5_taken_check_ignores_removed_currencies(market: Market) -> None:
    market.remove_currency(market.oats)
    market.remove_currency(market.pebbles)

    assert add_currency(market.client, market.gem_bot, "PBL")["http"] == 201


def test_leak_6_removed_currency_trades_are_404_but_stay_in_feeds(market: Market) -> None:
    traded = insert_transaction(market.connection, market.gems, market.oats, NOW - timedelta(hours=1))
    market.remove_currency(market.oats)
    log_in(market.client, market.connection, USER_ID)

    recent = [row["id"] for row in market.client.get("/transactions").json()]
    mine = [row["id"] for row in market.client.get("/me/transactions").json()]
    assert market.client.get(f"/currencies/{market.oats}/transactions").status_code == 404
    assert recent == [str(traded)]
    assert mine == [str(traded)]


@pytest.mark.parametrize("side", ["fromCurrencyId", "toCurrencyId"])
def test_leak_7_quote_treats_a_removed_currency_as_unknown(market: Market, side: str) -> None:
    market.remove_currency(market.oats)
    other = "toCurrencyId" if side == "fromCurrencyId" else "fromCurrencyId"

    response = market.client.get("/quote", params={side: str(market.oats), other: str(market.gems), "amount": "10"})

    assert (response.status_code, response.json()["field"]) == (404, side)


def test_leak_7_creating_into_a_removed_currency_is_404(market: Market) -> None:
    market.remove_currency(market.oats)

    with pytest.raises(ApiError, match="No currency with that ID"):
        market.convert(market.gems, market.oats)


def test_leak_8_daily_cap_counts_only_the_live_currency_with_that_abbreviation(market: Market) -> None:
    for _ in range(3):
        market.convert(market.gems, market.oats)

    market.connection.execute("UPDATE transactions SET status = 'Completed', handled_at = %s", (NOW,))
    market.remove_currency(market.oats)
    new_oats = UUID(add_currency(market.client, market.oat_bot, "OAT")["currency"]["id"])
    market.connection.execute("UPDATE currencies SET daily_cap = 50 WHERE id = %s", (new_oats,))

    created = create_transaction(market.connection, USER_ID, market.gems, new_oats, Decimal(10), NOW)

    assert created["status"] == "Pending"


def test_leak_9_admin_edits_and_reactivation_of_a_removed_currency_are_404(market: Market) -> None:
    market.remove_currency(market.oats)

    assert market.client.patch(f"/admin/currencies/{market.oats}", json={"active": True}).status_code == 404


def test_leak_10_owner_routes_leave_out_removed_currencies(market: Market) -> None:
    market.connection.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (market.oat_bot, market.pebbles))
    market.remove_currency(market.oats)
    log_in(market.client, market.connection, OWNER_ID)

    owned = {
        bot["id"]: [currency["abbreviation"] for currency in bot["currencies"]]
        for bot in market.client.get("/owner/bots").json()
    }
    bots = market.client.get("/me").json()["ownedBots"]
    oat_bot = next(bot for bot in bots if bot["id"] == str(market.oat_bot))
    assert market.client.get(f"/currencies/{market.oats}/settings").status_code == 404
    assert market.client.put(f"/currencies/{market.oats}/daily-cap", json={"dailyCap": 10}).status_code == 404
    assert owned == {str(market.oat_bot): ["PBL"], str(market.gem_bot): ["GEM"]}
    assert oat_bot["currencyIds"] == [str(market.pebbles)]


def test_leak_11_no_new_webhook_is_queued_for_a_removed_currency(market: Market) -> None:
    connect_webhook(market.connection, market.oats)
    traded = insert_transaction(market.connection, market.gems, market.oats, NOW, status="Pending")
    market.connection.execute("UPDATE currencies SET active = false, removed_at = %s WHERE id = %s", (NOW, market.oats))
    row = market.connection.execute(
        """
        SELECT id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at
        FROM transactions WHERE id = %s
        """,
        (traded,),
    ).fetchone()

    enqueue_webhook(market.connection, row, "resend", NOW)

    assert market.deliveries() == []


def test_leak_12_blocks_never_reverse_trades_with_a_removed_currency(market: Market) -> None:
    kept = insert_transaction(market.connection, market.gems, market.pebbles, NOW - timedelta(hours=2))
    touched = insert_transaction(market.connection, market.gems, market.oats, NOW - timedelta(hours=1))
    market.remove_currency(market.oats)
    gems_before = market.reserve(market.gems)

    block = {"userId": USER_ID, "reason": "Spam", "reverse": {"window": "all"}}
    response = market.client.post("/admin/blocks", json=block)

    assert [row["id"] for row in response.json()["reversed"]] == [str(kept)]
    assert market.status(touched) == "Completed"
    assert market.reserve(market.gems) != gems_before


def test_leak_12_owner_block_list_shows_only_the_bot_and_admin_blocks(market: Market) -> None:
    market.connection.execute(
        """
        INSERT INTO blocks (user_id, bot_id, reason, blocked_by, blocked_at)
        VALUES (%s, %s, 'Spam', %s, %s), ('700000000000000007', %s, 'Other', %s, %s),
            ('800000000000000008', NULL, 'Everywhere', %s, %s)
        """,
        (USER_ID, market.oat_bot, OWNER_ID, NOW, market.gem_bot, OWNER_ID, NOW, FIRST_ADMIN_ID, NOW),
    )
    log_in(market.client, market.connection, OWNER_ID)

    listed = market.client.get(f"/bots/{market.oat_bot}/blocks").json()

    assert sorted((row["userId"], row["level"]) for row in listed) == [
        (USER_ID, "bot"),
        ("800000000000000008", "global"),
    ]


def test_leak_14_removed_bot_token_fails_like_an_invalid_token(market: Market) -> None:
    token = issue_api_token(market.connection, market.oat_bot)
    market.remove_bot(market.oat_bot)

    removed = market.client.get(
        "/transactions/pending", params={"currencyId": str(market.oats)}, headers={"Authorization": f"Bearer {token}"}
    )
    invalid = market.client.get(
        "/transactions/pending", params={"currencyId": str(market.oats)}, headers={"Authorization": "Bearer nope"}
    )

    assert removed.status_code == 401
    assert removed.json() == invalid.json()


def test_leak_15_bot_queries_leave_out_removed_bots(market: Market) -> None:
    market.remove_bot(market.oat_bot)

    listed = [bot["id"] for bot in market.client.get("/admin/bots").json()]
    log_in(market.client, market.connection, OWNER_ID)
    owned_bots = [bot["id"] for bot in market.client.get("/me").json()["ownedBots"]]
    owner_bots = [
        (bot["id"], [currency["abbreviation"] for currency in bot["currencies"]])
        for bot in market.client.get("/owner/bots").json()
    ]
    assert listed == [str(market.gem_bot)]
    assert owned_bots == [str(market.gem_bot)]
    assert owner_bots == [(str(market.gem_bot), ["GEM"])]


def test_leak_15_bot_api_treats_its_own_removed_currency_as_unknown(market: Market) -> None:
    token = issue_api_token(market.connection, market.oat_bot)
    market.remove_currency(market.oats)

    pending = market.client.get(
        "/transactions/pending", params={"currencyId": str(market.oats)}, headers={"Authorization": f"Bearer {token}"}
    )
    created = market.client.post(
        "/transactions",
        headers={"Authorization": f"Bearer {token}"},
        json={"userId": USER_ID, "fromCurrencyId": str(market.oats), "toCurrencyId": str(market.gems), "amount": 10},
    )

    assert (pending.status_code, pending.json()["field"]) == (404, "currencyId")
    assert (created.status_code, created.json()["field"]) == (404, "fromCurrencyId")


def test_leak_16_bot_api_treats_a_removed_currency_as_unknown(market: Market) -> None:
    token = issue_api_token(market.connection, market.gem_bot)
    market.remove_currency(market.oats)

    response = market.client.post(
        "/transactions",
        headers={"Authorization": f"Bearer {token}"},
        json={"userId": USER_ID, "fromCurrencyId": str(market.gems), "toCurrencyId": str(market.oats), "amount": 10},
    )

    assert (response.status_code, response.json()["field"]) == (404, "toCurrencyId")
