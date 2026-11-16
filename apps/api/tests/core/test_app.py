import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import InvalidSettingError, MissingSettingError
from app.core.migrations import MIGRATIONS_DIRECTORY, apply_migrations
from app.main import create_app
from tests.factories import FIRST_ADMIN_ID, SECOND_ADMIN_ID


def test_health_checks_the_database(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
    assert client.head("/health").status_code == 200


def test_startup_applies_migrations(client: TestClient, connection: psycopg.Connection) -> None:
    row = connection.execute("SELECT count(*) AS applied FROM schema_migrations").fetchone()

    assert row is not None
    assert row["applied"] >= 1


def test_startup_seeds_the_first_admin(client: TestClient, connection: psycopg.Connection) -> None:
    assert admin_ids(connection) == [FIRST_ADMIN_ID]


def test_startup_seeds_every_listed_admin(
    api_environment: None, monkeypatch: pytest.MonkeyPatch, connection: psycopg.Connection
) -> None:
    monkeypatch.setenv("FIRST_ADMIN_IDS", f"{FIRST_ADMIN_ID}, {SECOND_ADMIN_ID}")
    with TestClient(create_app()):
        pass

    assert admin_ids(connection) == [FIRST_ADMIN_ID, SECOND_ADMIN_ID]


def test_startup_promotes_an_existing_user_listed_as_first_admin(
    api_environment: None, monkeypatch: pytest.MonkeyPatch, connection: psycopg.Connection
) -> None:
    apply_migrations(connection, MIGRATIONS_DIRECTORY)
    connection.execute("INSERT INTO users (id, username) VALUES (%s, 'existing')", (SECOND_ADMIN_ID,))

    monkeypatch.setenv("FIRST_ADMIN_IDS", f"{FIRST_ADMIN_ID},{SECOND_ADMIN_ID}")
    with TestClient(create_app()):
        pass

    promoted = connection.execute("SELECT username, is_admin FROM users WHERE id = %s", (SECOND_ADMIN_ID,)).fetchone()

    assert promoted == {"username": "existing", "is_admin": True}
    assert admin_ids(connection) == [FIRST_ADMIN_ID, SECOND_ADMIN_ID]


def test_first_admins_are_not_seeded_again_once_an_admin_exists(
    api_environment: None, monkeypatch: pytest.MonkeyPatch, connection: psycopg.Connection
) -> None:
    with TestClient(create_app()):
        pass

    monkeypatch.setenv("FIRST_ADMIN_IDS", f"{FIRST_ADMIN_ID},{SECOND_ADMIN_ID}")
    with TestClient(create_app()):
        pass

    assert admin_ids(connection) == [FIRST_ADMIN_ID]


@pytest.mark.parametrize("name", ["DATABASE_URL", "FIRST_ADMIN_IDS"])
def test_startup_fails_without_a_required_setting(
    api_environment: None, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    monkeypatch.delenv(name)

    with pytest.raises(MissingSettingError, match=name):
        create_app()


def test_startup_fails_with_a_malformed_first_admin(
    api_environment: None, monkeypatch: pytest.MonkeyPatch, connection: psycopg.Connection
) -> None:
    apply_migrations(connection, MIGRATIONS_DIRECTORY)
    monkeypatch.setenv("FIRST_ADMIN_IDS", f"{SECOND_ADMIN_ID},not-a-snowflake")

    with pytest.raises(InvalidSettingError, match="FIRST_ADMIN_IDS"):
        create_app()

    assert admin_ids(connection) == []


def test_startup_fails_while_the_old_first_admin_name_is_set(
    api_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FIRST_ADMIN_ID", FIRST_ADMIN_ID)

    with pytest.raises(InvalidSettingError, match="renamed to FIRST_ADMIN_IDS"):
        create_app()


def admin_ids(connection: psycopg.Connection) -> list[str]:
    rows = connection.execute("SELECT id FROM users WHERE is_admin ORDER BY id").fetchall()

    return [row["id"] for row in rows]


def test_unknown_route_uses_the_error_shape(client: TestClient) -> None:
    response = client.get("/nothing-here")

    assert response.status_code == 404
    assert response.json() == {"status": 404, "message": "Not Found", "field": None}
