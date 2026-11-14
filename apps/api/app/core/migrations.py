import re
from dataclasses import dataclass
from pathlib import Path

from psycopg import Connection
from psycopg.rows import tuple_row

MIGRATIONS_DIRECTORY = Path(__file__).resolve().parents[2] / "migrations"
MIGRATION_FILE_PATTERN = re.compile(r"^(?P<version>\d{4})_(?P<name>[a-z0-9_]+)\.sql$")
MIGRATION_LOCK_ID = 72_436_001

CREATE_SCHEMA_MIGRATIONS = """
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
    )
"""


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path


def apply_migrations(connection: Connection, directory: Path) -> list[Migration]:
    if not connection.autocommit:
        raise MigrationError("Migrations need an autocommit connection so each file commits on its own")

    migrations = load_migrations(directory)
    connection.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK_ID,))
    try:
        return apply_pending(connection, migrations)
    finally:
        connection.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK_ID,))


def load_migrations(directory: Path) -> list[Migration]:
    if not directory.is_dir():
        raise MigrationError(f"Migrations directory {directory} does not exist")

    migrations_by_version: dict[int, Migration] = {}

    for path in sorted(directory.glob("*.sql")):
        migration = parse_migration_path(path)
        if migration.version in migrations_by_version:
            raise MigrationError(f"Duplicate migration version {migration.version}: {path.name}")

        migrations_by_version[migration.version] = migration

    return sorted(migrations_by_version.values(), key=lambda migration: migration.version)


def parse_migration_path(path: Path) -> Migration:
    match = MIGRATION_FILE_PATTERN.match(path.name)
    if match is None:
        raise MigrationError(f"Migration file {path.name} must be named like 0001_create_things.sql")

    return Migration(version=int(match["version"]), name=match["name"], path=path)


def apply_pending(connection: Connection, migrations: list[Migration]) -> list[Migration]:
    with connection.transaction():
        connection.execute(CREATE_SCHEMA_MIGRATIONS)

    applied_names = read_applied_names(connection)
    check_applied_match_files(applied_names, migrations)

    pending = [migration for migration in migrations if migration.version not in applied_names]
    for migration in pending:
        apply_migration(connection, migration)

    return pending


def read_applied_names(connection: Connection) -> dict[int, str]:
    rows = connection.cursor(row_factory=tuple_row).execute("SELECT version, name FROM schema_migrations").fetchall()

    return {version: name for version, name in rows}


def check_applied_match_files(applied_names: dict[int, str], migrations: list[Migration]) -> None:
    file_names = {migration.version: migration.name for migration in migrations}

    for version, name in applied_names.items():
        file_name = file_names.get(version)
        if file_name is None:
            raise MigrationError(f"Applied migration {version}_{name} has no file")

        if file_name != name:
            raise MigrationError(f"Applied migration {version}_{name} was renamed to {version}_{file_name}")


def apply_migration(connection: Connection, migration: Migration) -> None:
    statements = migration.path.read_text(encoding="utf-8")

    with connection.transaction():
        connection.execute(statements)
        connection.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (%s, %s)",
            (migration.version, migration.name),
        )
