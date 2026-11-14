import secrets
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header
from psycopg import Connection
from psycopg.rows import DictRow

from app.auth.sessions import hash_secret
from app.core.database import Database
from app.core.errors import ApiError

TOKEN_PREFIX = "dsc_live_"
BEARER_PREFIX = "Bearer "


def issue_api_token(db: Connection[DictRow], currency_id: UUID) -> str:
    token = TOKEN_PREFIX + secrets.token_urlsafe(24)
    db.execute("UPDATE currencies SET api_token_hash = %s WHERE id = %s", (hash_secret(token), currency_id))

    return token


def bot_currency_id(db: Database, authorization: Annotated[str | None, Header()] = None) -> UUID:
    if authorization is None or not authorization.startswith(BEARER_PREFIX):
        raise ApiError(401, "Send your currency's API token as Authorization: Bearer <token>.")

    token = authorization.removeprefix(BEARER_PREFIX)
    row = db.execute("SELECT id FROM currencies WHERE api_token_hash = %s", (hash_secret(token),)).fetchone()
    if row is None:
        raise ApiError(401, "That API token isn't valid. Regenerate it on the bot owner page.")

    return row["id"]


BotCurrencyId = Annotated[UUID, Depends(bot_currency_id)]
