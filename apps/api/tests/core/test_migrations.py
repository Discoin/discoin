import shutil
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.core.migrations import MIGRATIONS_DIRECTORY, MigrationError, apply_migrations


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


def test_multiplier_migration_gives_existing_currencies_4_and_keeps_their_reserve(
    connection: psycopg.Connection, tmp_path: Path
) -> None:
    for file_name in ("0001_initial_schema.sql", "0002_user_avatar.sql"):
        shutil.copy(MIGRATIONS_DIRECTORY / file_name, tmp_path / file_name)

    apply_migrations(connection, tmp_path)
    connection.execute(
        """
        INSERT INTO currencies (id, name, abbreviation, owner_id, reserve, weekly_median)
        VALUES ('019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21', 'Oats', 'OAT', '200000000000000002', 123456.78, 50000)
        """
    )

    apply_migrations(connection, MIGRATIONS_DIRECTORY)

    stored = connection.execute("SELECT reserve, multiplier FROM currencies").fetchone()
    assert stored == {"reserve": Decimal("123456.78"), "multiplier": 4}


def test_multiplier_is_required_with_no_default(connection: psycopg.Connection) -> None:
    apply_migrations(connection, MIGRATIONS_DIRECTORY)

    with pytest.raises(psycopg.errors.NotNullViolation):
        connection.execute(
            """
            INSERT INTO currencies (id, name, abbreviation, reserve, weekly_median)
            VALUES ('019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21', 'Oats', 'OAT', 100000, 25000)
            """
        )


OATS = "019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21"
GEMS = "019a6f11-7d56-7a11-b3e5-0c98a4d72f6b"
PENDING_ID = "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4"
BLOCKED_USER = "300000000000000003"


@pytest.fixture
def at_multiplier_release(connection: psycopg.Connection, tmp_path: Path) -> psycopg.Connection:
    for file_name in ("0001_initial_schema.sql", "0002_user_avatar.sql", "0003_currency_multiplier.sql"):
        shutil.copy(MIGRATIONS_DIRECTORY / file_name, tmp_path / file_name)

    apply_migrations(connection, tmp_path)
    connection.execute(
        """
        INSERT INTO currencies
            (id, name, abbreviation, owner_id, reserve, weekly_median, multiplier,
             webhook_url, webhook_secret_sealed, api_token_hash)
        VALUES
            (%(oats)s, 'Oats', 'OAT', '200000000000000002', 100000, 25000, 4,
             'https://oats.example.com', 'v1.sealed', 'token-hash'),
            (%(gems)s, 'Gems', 'GEM', '200000000000000009', 100000, 25000, 4, NULL, NULL, NULL)
        """,
        {"oats": OATS, "gems": GEMS},
    )
    connection.execute(
        """
        INSERT INTO blocks (user_id, currency_id, reason, blocked_by, blocked_at)
        VALUES (%s, %s, 'Spam', '200000000000000002', now())
        """,
        (BLOCKED_USER, OATS),
    )
    connection.execute(
        """
        INSERT INTO transactions (id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at)
        VALUES (%s, %s, %s, %s, 100, 10, 'Pending', now())
        """,
        (PENDING_ID, BLOCKED_USER, GEMS, OATS),
    )
    connection.execute(
        """
        INSERT INTO webhook_deliveries (transaction_id, currency_id, event, payload, next_attempt_at)
        VALUES (%s, %s, 'created', '{}', now())
        """,
        (PENDING_ID, OATS),
    )
    apply_migrations(connection, MIGRATIONS_DIRECTORY)

    return connection


def column_names(connection: psycopg.Connection, table: str) -> set[str]:
    rows = connection.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = %s",
        (table,),
    ).fetchall()

    return {row["column_name"] for row in rows}


def test_bots_migration_leaves_every_currency_botless_and_live(at_multiplier_release: psycopg.Connection) -> None:
    rows = at_multiplier_release.execute(
        "SELECT abbreviation, bot_id, removed_at FROM currencies ORDER BY 1"
    ).fetchall()

    assert rows == [
        {"abbreviation": "GEM", "bot_id": None, "removed_at": None},
        {"abbreviation": "OAT", "bot_id": None, "removed_at": None},
    ]
    assert at_multiplier_release.execute("SELECT count(*) AS bots FROM bots").fetchone()["bots"] == 0


def test_bots_migration_drops_owner_token_and_webhook_columns(at_multiplier_release: psycopg.Connection) -> None:
    dropped = {"owner_id", "webhook_url", "webhook_secret_sealed", "api_token_hash"}

    assert column_names(at_multiplier_release, "currencies") & dropped == set()


def test_bots_migration_keeps_pending_transactions_and_blocks(at_multiplier_release: psycopg.Connection) -> None:
    transaction = at_multiplier_release.execute("SELECT status FROM transactions").fetchone()
    block = at_multiplier_release.execute("SELECT currency_id, bot_id, unblocked_at FROM blocks").fetchone()

    assert transaction == {"status": "Pending"}
    assert block == {"currency_id": UUID(OATS), "bot_id": None, "unblocked_at": None}


def test_bots_migration_drops_deliveries_that_lost_their_webhook(at_multiplier_release: psycopg.Connection) -> None:
    delivery = at_multiplier_release.execute("SELECT state, last_error FROM webhook_deliveries").fetchone()

    assert delivery["state"] == "dropped"
    assert delivery["last_error"].startswith("The currency webhook was removed")


def test_abbreviation_is_unique_among_live_currencies_only(at_multiplier_release: psycopg.Connection) -> None:
    at_multiplier_release.execute("UPDATE currencies SET active = false, removed_at = now() WHERE id = %s", (OATS,))
    insert_oats = """
        INSERT INTO currencies (id, name, abbreviation, reserve, weekly_median, multiplier)
        VALUES (%s, 'New oats', 'OAT', 100000, 25000, 4)
    """
    second = "019a8000-0000-7000-8000-000000000001"
    third = "019a8000-0000-7000-8000-000000000002"
    at_multiplier_release.execute(insert_oats, (second,))
    at_multiplier_release.execute("UPDATE currencies SET active = false, removed_at = now() WHERE id = %s", (second,))
    at_multiplier_release.execute(insert_oats, (third,))

    with pytest.raises(psycopg.errors.UniqueViolation):
        at_multiplier_release.execute(insert_oats, ("019a8000-0000-7000-8000-000000000003",))

    removed = at_multiplier_release.execute(
        "SELECT count(*) AS removed FROM currencies WHERE abbreviation = 'OAT' AND removed_at IS NOT NULL"
    ).fetchone()
    assert removed["removed"] == 2


def test_bot_discord_id_is_unique_among_live_bots_only(at_multiplier_release: psycopg.Connection) -> None:
    insert_bot = "INSERT INTO bots (id, name, discord_id, owner_id) VALUES (%s, 'Oat bot', '400000000000000004', %s)"
    first = "019a8000-0000-7000-8000-000000000011"
    second = "019a8000-0000-7000-8000-000000000012"
    at_multiplier_release.execute(insert_bot, (first, BLOCKED_USER))
    at_multiplier_release.execute("UPDATE bots SET removed_at = now() WHERE id = %s", (first,))
    at_multiplier_release.execute(insert_bot, (second, BLOCKED_USER))
    at_multiplier_release.execute("UPDATE bots SET removed_at = now() WHERE id = %s", (second,))
    at_multiplier_release.execute(insert_bot, ("019a8000-0000-7000-8000-000000000013", BLOCKED_USER))

    with pytest.raises(psycopg.errors.UniqueViolation):
        at_multiplier_release.execute(insert_bot, ("019a8000-0000-7000-8000-000000000014", BLOCKED_USER))


def test_removed_bot_cannot_keep_a_token(at_multiplier_release: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        at_multiplier_release.execute(
            """
            INSERT INTO bots (id, name, discord_id, owner_id, api_token_hash, removed_at)
            VALUES ('019a8000-0000-7000-8000-000000000021', 'Gone', '400000000000000004', %s, 'hash', now())
            """,
            (BLOCKED_USER,),
        )


def test_removed_currency_must_be_inactive(at_multiplier_release: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        at_multiplier_release.execute("UPDATE currencies SET removed_at = now() WHERE id = %s", (OATS,))


def test_event_feed_migration_gives_existing_and_new_bots_an_empty_feed(
    connection: psycopg.Connection, tmp_path: Path
) -> None:
    insert_bot = "INSERT INTO bots (id, name, discord_id, owner_id) VALUES (%s, 'Oat bot', %s, %s)"
    existing = "019a8000-0000-7000-8000-000000000031"
    added_later = "019a8000-0000-7000-8000-000000000032"

    for migration in sorted(MIGRATIONS_DIRECTORY.glob("000[1-4]_*.sql")):
        shutil.copy(migration, tmp_path / migration.name)

    apply_migrations(connection, tmp_path)
    connection.execute(insert_bot, (existing, "400000000000000004", BLOCKED_USER))

    apply_migrations(connection, MIGRATIONS_DIRECTORY)
    connection.execute(insert_bot, (added_later, "400000000000000005", BLOCKED_USER))

    feeds = connection.execute("SELECT bot_id, last_event_id FROM bot_feeds ORDER BY bot_id")
    assert feeds.fetchall() == [
        {"bot_id": UUID(existing), "last_event_id": 0},
        {"bot_id": UUID(added_later), "last_event_id": 0},
    ]


def test_undone_handled_migration_adds_two_nullable_columns_and_leaves_rows_untouched(
    connection: psycopg.Connection, tmp_path: Path
) -> None:
    added = {"receiver_handled_at", "sender_handled_at"}

    for migration in sorted(MIGRATIONS_DIRECTORY.glob("000[1-5]_*.sql")):
        shutil.copy(migration, tmp_path / migration.name)

    apply_migrations(connection, tmp_path)
    connection.execute(
        """
        INSERT INTO currencies (id, name, abbreviation, reserve, weekly_median, multiplier)
        VALUES (%s, 'Oats', 'OAT', 100000, 25000, 4), (%s, 'Gems', 'GEM', 100000, 25000, 4)
        """,
        (OATS, GEMS),
    )
    connection.execute(
        """
        INSERT INTO transactions
            (id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at)
        VALUES (%s, %s, %s, %s, 100, 10, 'Reversed', now(), now())
        """,
        (PENDING_ID, BLOCKED_USER, GEMS, OATS),
    )
    before = connection.execute("SELECT * FROM transactions").fetchone()

    apply_migrations(connection, MIGRATIONS_DIRECTORY)

    after = connection.execute("SELECT * FROM transactions").fetchone()
    nullable = connection.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'transactions' AND is_nullable = 'YES'
        """
    ).fetchall()
    assert after == {**before, "receiver_handled_at": None, "sender_handled_at": None}
    assert added <= {row["column_name"] for row in nullable}
    assert added & set(before) == set()


def test_webhook_tests_migration_adds_test_false_to_stored_payloads_that_lack_it(
    connection: psycopg.Connection, tmp_path: Path
) -> None:
    bot = "019a8000-0000-7000-8000-000000000041"
    insert_event = "INSERT INTO bot_events (bot_id, id, event, payload, created_at) VALUES (%s, %s, 'e', %s, now())"
    insert_delivery = """
        INSERT INTO webhook_deliveries (transaction_id, currency_id, event, payload, next_attempt_at)
        VALUES (%s, %s, 'created', %s, now())
    """

    for migration in sorted(MIGRATIONS_DIRECTORY.glob("000[1-6]_*.sql")):
        shutil.copy(migration, tmp_path / migration.name)

    apply_migrations(connection, tmp_path)
    connection.execute(
        "INSERT INTO bots (id, name, discord_id, owner_id) VALUES (%s, 'Oat bot', '400000000000000004', %s)",
        (bot, BLOCKED_USER),
    )
    connection.execute(
        """
        INSERT INTO currencies (id, name, abbreviation, reserve, weekly_median, multiplier)
        VALUES (%s, 'Oats', 'OAT', 100000, 25000, 4), (%s, 'Gems', 'GEM', 100000, 25000, 4)
        """,
        (OATS, GEMS),
    )
    connection.execute(
        """
        INSERT INTO transactions (id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at)
        VALUES (%s, %s, %s, %s, 100, 10, 'Pending', now())
        """,
        (PENDING_ID, BLOCKED_USER, GEMS, OATS),
    )
    connection.execute(insert_event, (bot, 1, Jsonb({"event": "transaction.created"})))
    connection.execute(insert_event, (bot, 2, Jsonb({"event": "transaction.created", "test": True})))
    connection.execute(insert_delivery, (PENDING_ID, OATS, Jsonb({"event": "transaction.created"})))
    connection.execute(insert_delivery, (PENDING_ID, OATS, Jsonb({"event": "transaction.created", "test": True})))

    apply_migrations(connection, MIGRATIONS_DIRECTORY)

    events = connection.execute("SELECT payload FROM bot_events ORDER BY id").fetchall()
    deliveries = connection.execute("SELECT payload FROM webhook_deliveries ORDER BY id").fetchall()
    backfilled = [{"event": "transaction.created", "test": False}, {"event": "transaction.created", "test": True}]
    assert [row["payload"] for row in events] == backfilled
    assert [row["payload"] for row in deliveries] == backfilled


def test_event_results_migration_marks_events_at_or_below_the_cursor_handled_and_drops_the_cursor(
    connection: psycopg.Connection, tmp_path: Path
) -> None:
    bot = "019a8000-0000-7000-8000-000000000051"
    created_at = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
    insert_event = "INSERT INTO bot_events (bot_id, id, event, payload, created_at) VALUES (%s, %s, 'e', '{}', %s)"

    for migration in sorted(MIGRATIONS_DIRECTORY.glob("000[1-7]_*.sql")):
        shutil.copy(migration, tmp_path / migration.name)

    apply_migrations(connection, tmp_path)
    connection.execute(
        "INSERT INTO bots (id, name, discord_id, owner_id) VALUES (%s, 'Oat bot', '400000000000000004', %s)",
        (bot, BLOCKED_USER),
    )

    for event_id in (1, 2, 3):
        connection.execute(insert_event, (bot, event_id, created_at))

    connection.execute("UPDATE bot_feeds SET last_event_id = 3, acknowledged_event_id = 2")

    apply_migrations(connection, MIGRATIONS_DIRECTORY)

    events = connection.execute("SELECT id, state, attempt, next_attempt_at FROM bot_events ORDER BY id").fetchall()
    assert events == [
        {"id": 1, "state": "handled", "attempt": 0, "next_attempt_at": created_at},
        {"id": 2, "state": "handled", "attempt": 0, "next_attempt_at": created_at},
        {"id": 3, "state": "pending", "attempt": 0, "next_attempt_at": created_at},
    ]
    assert column_names(connection, "bot_feeds") == {"bot_id", "last_event_id"}


def test_needs_autocommit_connection(database_url: str, tmp_path: Path) -> None:
    with psycopg.connect(database_url) as connection, pytest.raises(MigrationError, match="autocommit"):
        apply_migrations(connection, tmp_path)
