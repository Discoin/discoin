from pathlib import Path

import psycopg
import pytest

from app.core.migrations import MigrationError, apply_migrations


def write_migration(directory: Path, file_name: str, statements: str) -> None:
    (directory / file_name).write_text(statements, encoding="utf-8")


def applied_versions(connection: psycopg.Connection) -> list[int]:
    rows = connection.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()

    return [row["version"] for row in rows]


def table_exists(connection: psycopg.Connection, table: str) -> bool:
    row = connection.execute("SELECT to_regclass(%s) IS NOT NULL AS found", (table,)).fetchone()

    return row is not None and row["found"]


def test_applies_files_in_version_order(connection: psycopg.Connection, tmp_path: Path) -> None:
    write_migration(tmp_path, "0002_add_label.sql", "ALTER TABLE things ADD COLUMN label text;")
    write_migration(tmp_path, "0001_create_things.sql", "CREATE TABLE things (id integer);")

    applied = apply_migrations(connection, tmp_path)

    assert [migration.version for migration in applied] == [1, 2]
    assert applied_versions(connection) == [1, 2]


def test_runs_every_statement_in_a_file(connection: psycopg.Connection, tmp_path: Path) -> None:
    write_migration(
        tmp_path,
        "0001_create_two_tables.sql",
        "CREATE TABLE first (id integer);\nCREATE TABLE second (id integer);\n",
    )

    apply_migrations(connection, tmp_path)

    assert table_exists(connection, "first")
    assert table_exists(connection, "second")


def test_skips_applied_files(connection: psycopg.Connection, tmp_path: Path) -> None:
    write_migration(tmp_path, "0001_create_things.sql", "CREATE TABLE things (id integer);")
    apply_migrations(connection, tmp_path)
    write_migration(tmp_path, "0002_create_others.sql", "CREATE TABLE others (id integer);")

    applied = apply_migrations(connection, tmp_path)

    assert [migration.version for migration in applied] == [2]
    assert applied_versions(connection) == [1, 2]


def test_failed_file_is_rolled_back_and_not_recorded(connection: psycopg.Connection, tmp_path: Path) -> None:
    write_migration(tmp_path, "0001_create_things.sql", "CREATE TABLE things (id integer);")
    write_migration(tmp_path, "0002_broken.sql", "CREATE TABLE others (id integer);\nSELECT broken_function();")

    with pytest.raises(psycopg.errors.UndefinedFunction):
        apply_migrations(connection, tmp_path)

    assert applied_versions(connection) == [1]
    assert not table_exists(connection, "others")


def test_missing_directory_raises(connection: psycopg.Connection, tmp_path: Path) -> None:
    with pytest.raises(MigrationError, match="does not exist"):
        apply_migrations(connection, tmp_path / "missing")


def test_badly_named_file_raises(connection: psycopg.Connection, tmp_path: Path) -> None:
    write_migration(tmp_path, "create_things.sql", "CREATE TABLE things (id integer);")

    with pytest.raises(MigrationError, match="must be named like"):
        apply_migrations(connection, tmp_path)


def test_duplicate_version_raises(connection: psycopg.Connection, tmp_path: Path) -> None:
    write_migration(tmp_path, "0001_create_things.sql", "CREATE TABLE things (id integer);")
    write_migration(tmp_path, "0001_create_others.sql", "CREATE TABLE others (id integer);")

    with pytest.raises(MigrationError, match="Duplicate migration version 1"):
        apply_migrations(connection, tmp_path)


def test_applied_file_removed_from_disk_raises(connection: psycopg.Connection, tmp_path: Path) -> None:
    write_migration(tmp_path, "0001_create_things.sql", "CREATE TABLE things (id integer);")
    apply_migrations(connection, tmp_path)
    (tmp_path / "0001_create_things.sql").unlink()

    with pytest.raises(MigrationError, match="has no file"):
        apply_migrations(connection, tmp_path)


def test_applied_file_renamed_raises(connection: psycopg.Connection, tmp_path: Path) -> None:
    write_migration(tmp_path, "0001_create_things.sql", "CREATE TABLE things (id integer);")
    apply_migrations(connection, tmp_path)
    (tmp_path / "0001_create_things.sql").rename(tmp_path / "0001_create_stuff.sql")

    with pytest.raises(MigrationError, match="was renamed"):
        apply_migrations(connection, tmp_path)


def test_needs_autocommit_connection(database_url: str, tmp_path: Path) -> None:
    with psycopg.connect(database_url) as connection, pytest.raises(MigrationError, match="autocommit"):
        apply_migrations(connection, tmp_path)
