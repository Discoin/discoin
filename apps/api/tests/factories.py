import base64
import itertools
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid7

from fastapi.testclient import TestClient
from psycopg import Connection

from app.auth.sessions import SESSION_COOKIE, hash_secret
from app.currencies.queries import record_history

FIRST_ADMIN_ID = "100000000000000001"
SECOND_ADMIN_ID = "100000000000000002"
NOW = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
FRONTEND_URL = "https://discoin.example.com/"
FRONTEND_ORIGIN = "https://discoin.example.com"
WEBHOOK_SECRET_KEY = base64.b64encode(bytes(range(32))).decode()
OWNER_ID = "200000000000000002"
USER_ID = "300000000000000003"
MULTIPLIER = 4
FIRST_BOT_DISCORD_ID = 900_000_000_000_000_000
BOT_NUMBERS = itertools.count(1)
LOCK_TIMEOUT_MS = 200


def create_bot(db: Connection, owner_id: str = OWNER_ID) -> UUID:
    bot_id = uuid7()
    number = next(BOT_NUMBERS)
    db.execute(
        "INSERT INTO bots (id, name, discord_id, owner_id) VALUES (%s, %s, %s, %s)",
        (bot_id, f"Bot {number}", str(FIRST_BOT_DISCORD_ID + number), owner_id),
    )

    return bot_id


def create_currency(
    db: Connection,
    abbreviation: str,
    reserve: Decimal | int,
    history: list[tuple[datetime, Decimal | int]] | None = None,
) -> UUID:
    currency_id = create_botless_currency(db, abbreviation, reserve, history)
    db.execute("UPDATE currencies SET bot_id = %s WHERE id = %s", (create_bot(db), currency_id))

    return currency_id


def create_botless_currency(
    db: Connection,
    abbreviation: str,
    reserve: Decimal | int,
    history: list[tuple[datetime, Decimal | int]] | None = None,
) -> UUID:
    currency_id = uuid7()
    db.execute(
        """
        INSERT INTO currencies (id, name, abbreviation, reserve, weekly_median, multiplier)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (currency_id, f"{abbreviation} coin", abbreviation, reserve, Decimal(reserve) / MULTIPLIER, MULTIPLIER),
    )

    for at, past_reserve in history or [(NOW - timedelta(days=60), reserve)]:
        record_history(db, currency_id, Decimal(past_reserve), at)

    return currency_id


def bot_of(db: Connection, currency_id: UUID) -> UUID:
    return db.execute("SELECT bot_id FROM currencies WHERE id = %s", (currency_id,)).fetchone()["bot_id"]


def deactivate(db: Connection, currency_id: UUID) -> None:
    db.execute("UPDATE currencies SET active = false WHERE id = %s", (currency_id,))


def create_transaction(
    db: Connection,
    source: UUID,
    target: UUID,
    submitted_at: datetime,
    status: str = "Completed",
    user_id: str = USER_ID,
) -> UUID:
    transaction_id = uuid7()
    handled_at = None if status == "Pending" else submitted_at
    db.execute(
        """
        INSERT INTO transactions
            (id, user_id, from_currency_id, to_currency_id, amount, payout, status, submitted_at, handled_at)
        VALUES (%s, %s, %s, %s, 100, 10, %s, %s, %s)
        """,
        (transaction_id, user_id, source, target, status, submitted_at, handled_at),
    )

    return transaction_id


def log_in(client: TestClient, db: Connection, user_id: str) -> None:
    db.execute(
        "INSERT INTO users (id, username) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
        (user_id, f"user {user_id[-4:]}"),
    )
    token = f"session-{user_id}"
    db.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
        (hash_secret(token), user_id, NOW + timedelta(days=1)),
    )
    client.cookies.set(SESSION_COOKIE, token)
