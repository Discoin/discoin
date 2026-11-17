import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Cookie, Depends
from psycopg import Connection
from psycopg.rows import DictRow

from app.auth.discord import DiscordUser
from app.core.database import Database, Now
from app.core.errors import ApiError

SESSION_COOKIE = "discoin_session"
SESSION_LIFETIME = timedelta(days=30)


@dataclass(frozen=True)
class User:
    id: str
    username: str | None
    avatar_hash: str | None
    is_admin: bool


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def start_session(db: Connection[DictRow], discord_user: DiscordUser, now: datetime) -> str:
    db.execute(
        """
        INSERT INTO users (id, username, avatar_hash) VALUES (%s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, avatar_hash = EXCLUDED.avatar_hash
        """,
        (discord_user.id, discord_user.username, discord_user.avatar_hash),
    )
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (%s, %s, %s, %s)",
        (hash_secret(token), discord_user.id, now, now + SESSION_LIFETIME),
    )

    return token


def end_session(db: Connection[DictRow], token: str) -> None:
    db.execute("DELETE FROM sessions WHERE token_hash = %s", (hash_secret(token),))


def logged_in_user(
    db: Database,
    now: Now,
    session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    if session is None:
        raise ApiError(401, "Log in with Discord first.")

    user = session_user(db, session, now)
    if user is None:
        raise ApiError(401, "Your login has expired. Log in with Discord again.")

    return user


def viewing_user(
    db: Database,
    now: Now,
    session: Annotated[str | None, Cookie(alias=SESSION_COOKIE, include_in_schema=False)] = None,
) -> User | None:
    if session is None:
        return None

    return session_user(db, session, now)


def session_user(db: Connection[DictRow], session: str, now: datetime) -> User | None:
    row = db.execute(
        """
        SELECT users.id, users.username, users.avatar_hash, users.is_admin FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = %s AND sessions.expires_at > %s
        """,
        (hash_secret(session), now),
    ).fetchone()
    if row is None:
        return None

    return User(id=row["id"], username=row["username"], avatar_hash=row["avatar_hash"], is_admin=row["is_admin"])


def admin_user(user: Annotated[User, Depends(logged_in_user)]) -> User:
    if not user.is_admin:
        raise ApiError(403, "Only Discoin admins can do that.")

    return user


LoggedInUser = Annotated[User, Depends(logged_in_user)]
ViewingUser = Annotated[User | None, Depends(viewing_user)]
AdminUser = Annotated[User, Depends(admin_user)]
