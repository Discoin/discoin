import psycopg
from fastapi.testclient import TestClient

from app.currencies.seed import SAMPLE_CURRENCIES, seed_sample_currencies
from tests.factories import NOW, OWNER_ID


def test_seed_adds_sample_currencies_once(client: TestClient, connection: psycopg.Connection) -> None:
    first = seed_sample_currencies(connection, OWNER_ID, NOW)
    second = seed_sample_currencies(connection, OWNER_ID, NOW)

    assert first == [sample.abbreviation for sample in SAMPLE_CURRENCIES]
    assert second == []


def test_seeded_currencies_have_a_month_of_history(client: TestClient, connection: psycopg.Connection) -> None:
    seed_sample_currencies(connection, OWNER_ID, NOW)

    currencies = client.get("/currencies").json()
    history = client.get(f"/currencies/{currencies[0]['id']}/history", params={"days": 30}).json()

    assert len(currencies) == len(SAMPLE_CURRENCIES)
    assert all(len(currency["valueHistory"]) == 8 for currency in currencies)
    assert len(history) == 31
