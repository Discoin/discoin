import base64
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid7

from fastapi.testclient import TestClient
from psycopg import Connection

from app.auth.sessions import SESSION_COOKIE, hash_secret
from app.currencies.queries import record_history

FIRST_ADMIN_ID = "100000000000000001"
NOW = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
FRONTEND_URL = "https://discoin.example.com/"
FRONTEND_ORIGIN = "https://discoin.example.com"
WEBHOOK_SECRET_KEY = base64.b64encode(bytes(range(32))).decode()
OWNER_ID = "200000000000000002"
USER_ID = "300000000000000003"


def create_currency(
    db: Connection,
    abbreviation: str,
    reserve: Decimal | int,
    history: list[tuple[datetime, Decimal | int]] | None = None,
) -> UUID:
    currency_id = uuid7()
    db.execute(
        """
        INSERT INTO currencies (id, name, abbreviation, owner_id, reserve, weekly_median)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (currency_id, f"{abbreviation} coin", abbreviation, OWNER_ID, reserve, Decimal(reserve) / 4),
    )

    for at, past_reserve in history or [(NOW - timedelta(days=60), reserve)]:
        record_history(db, currency_id, Decimal(past_reserve), at)

    return currency_id


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
