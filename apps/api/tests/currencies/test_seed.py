from contextlib import nullcontext
from uuid import uuid7

import psycopg
import pytest
from fastapi.testclient import TestClient

import app.currencies.seed
from app.currencies.seed import (
    ALREADY_EXISTS,
    BOT_REMOVED,
    CURRENCY_REMOVED,
    SAMPLE_BOTS,
    SAMPLE_CURRENCIES,
    SeedResult,
    main,
    seed_sample_currencies,
)
from tests.factories import NOW, OWNER_ID, create_botless_currency


def test_seed_adds_sample_currencies_once(client: TestClient, connection: psycopg.Connection) -> None:
    first = seed_sample_currencies(connection, OWNER_ID, NOW)
    second = seed_sample_currencies(connection, OWNER_ID, NOW)

    assert first == SeedResult(seeded=[sample.abbreviation for sample in SAMPLE_CURRENCIES], skipped={})
    assert second == SeedResult(
        seeded=[], skipped={sample.abbreviation: ALREADY_EXISTS for sample in SAMPLE_CURRENCIES}
    )


def test_seeded_currencies_have_a_month_of_history(client: TestClient, connection: psycopg.Connection) -> None:
    seed_sample_currencies(connection, OWNER_ID, NOW)

    currencies = client.get("/currencies").json()
    history = client.get(f"/currencies/{currencies[0]['id']}/history", params={"days": 30}).json()

    assert len(currencies) == len(SAMPLE_CURRENCIES)
    assert all(len(currency["valueHistory"]) == 8 for currency in currencies)
    assert len(history) == 31


def test_each_seeded_currency_gets_a_multiplier_of_4_and_its_own_bot_for_the_owner(
    client: TestClient, connection: psycopg.Connection
) -> None:
    seed_sample_currencies(connection, OWNER_ID, NOW)

    rows = connection.execute(
        """
        SELECT c.abbreviation, c.multiplier, b.name, b.owner_id
        FROM currencies c JOIN bots b ON b.id = c.bot_id ORDER BY 1
        """
    ).fetchall()

    assert [(row["abbreviation"], row["multiplier"], row["owner_id"]) for row in rows] == sorted(
        (sample.abbreviation, 4, OWNER_ID) for sample in SAMPLE_CURRENCIES
    )
    assert rows[0]["name"] == "Gems bot"


def test_seed_ignores_a_removed_currency_with_a_sample_abbreviation(
    client: TestClient, connection: psycopg.Connection
) -> None:
    removed = create_botless_currency(connection, "OAT", 100_000)
    connection.execute("UPDATE currencies SET active = false, removed_at = %s WHERE id = %s", (NOW, removed))

    result = seed_sample_currencies(connection, OWNER_ID, NOW)

    assert "OAT" in result.seeded
    assert client.get("/currencies/OAT").json()["name"] == "Oats"


def test_seed_fails_when_a_live_bot_already_has_a_sample_discord_id(
    client: TestClient, connection: psycopg.Connection
) -> None:
    connection.execute(
        "INSERT INTO bots (id, name, discord_id, owner_id) VALUES (%s, 'Other', %s, %s)",
        (uuid7(), SAMPLE_BOTS["OAT"].discord_id, OWNER_ID),
    )

    with pytest.raises(psycopg.errors.UniqueViolation):
        seed_sample_currencies(connection, OWNER_ID, NOW)


def test_seed_says_it_skipped_a_sample_that_was_removed(client: TestClient, connection: psycopg.Connection) -> None:
    seed_sample_currencies(connection, OWNER_ID, NOW)
    connection.execute("UPDATE currencies SET active = false, removed_at = %s WHERE abbreviation = 'OAT'", (NOW,))

    result = seed_sample_currencies(connection, OWNER_ID, NOW)

    assert (result.seeded, result.skipped["OAT"]) == ([], CURRENCY_REMOVED)
    assert client.get("/currencies/OAT").status_code == 404


def test_seed_prints_why_it_skipped_each_sample(
    client: TestClient, connection: psycopg.Connection, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    monkeypatch.setenv("SEED_OWNER_ID", OWNER_ID)
    seed_sample_currencies(connection, OWNER_ID, NOW)
    connection.execute("UPDATE bots SET removed_at = %s WHERE id = %s", (NOW, SAMPLE_BOTS["OAT"].id))
    with monkeypatch.context() as patched:
        patched.setattr(app.currencies.seed.psycopg, "connect", lambda _: nullcontext(connection))
        main()

    printed = capsys.readouterr().out.splitlines()
    assert printed[0] == "Seeded 0 sample currencies: none"
    assert f"Skipped OAT because {BOT_REMOVED}." in printed
