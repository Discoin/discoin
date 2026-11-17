from collections.abc import Iterator
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import DictRow, dict_row

from app.core.config import require_environment_variable
from app.core.database import current_time
from app.main import create_app
from tests.factories import (
    ADMIN_ID,
    FRONTEND_ORIGIN,
    FRONTEND_URL,
    NOW,
    WEBHOOK_SECRET_KEY,
    create_currency,
    log_in,
)


@pytest.fixture(scope="session")
def server_database_url() -> str:
    return require_environment_variable("DATABASE_URL")


@pytest.fixture
def database_url(server_database_url: str) -> Iterator[str]:
    schema_name = f"test_{uuid4().hex}"
    run_statement(server_database_url, sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name)))

    yield make_conninfo(server_database_url, options=f"-c search_path={schema_name}")

    run_statement(server_database_url, sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema_name)))


@pytest.fixture
def connection(database_url: str) -> Iterator[psycopg.Connection[DictRow]]:
    with psycopg.connect(database_url, autocommit=True, row_factory=dict_row) as connection:
        yield connection


@pytest.fixture
def api_environment(monkeypatch: pytest.MonkeyPatch, database_url: str) -> None:
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("FIRST_ADMIN_IDS", ADMIN_ID)
    monkeypatch.setenv("DISCORD_CLIENT_ID", "discord-client")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "discord-secret")
    monkeypatch.setenv("DISCORD_REDIRECT_URI", "https://api.example.com/auth/discord/callback")
    monkeypatch.setenv("FRONTEND_URL", FRONTEND_URL)
    monkeypatch.setenv("WEBHOOK_SECRET_KEY", WEBHOOK_SECRET_KEY)


@pytest.fixture
def client(api_environment: None) -> Iterator[TestClient]:
    application = create_app()
    application.dependency_overrides[current_time] = lambda: NOW

    with TestClient(application, base_url="https://testserver", headers={"Origin": FRONTEND_ORIGIN}) as client:
        yield client


@pytest.fixture
def as_admin(client: TestClient, connection: psycopg.Connection) -> None:
    log_in(client, connection, ADMIN_ID)


@pytest.fixture
def pair(client: TestClient, connection: psycopg.Connection) -> tuple[UUID, UUID]:
    return create_currency(connection, "RCH", 1_000_000), create_currency(connection, "POR", 100_000)


def run_statement(database_url: str, statement: sql.Composed) -> None:
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute(statement)
