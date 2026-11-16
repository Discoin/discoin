from uuid import UUID

from fastapi import APIRouter

from app.auth.avatars import avatar_url, default_avatar_url
from app.auth.sessions import LoggedInUser
from app.core.database import Database
from app.core.models import CamelModel
from app.transactions.models import Transaction
from app.transactions.queries import PageQuery, list_user_transactions

router = APIRouter(prefix="/me", tags=["login"])


class OwnedBot(CamelModel):
    id: UUID
    name: str
    currency_ids: list[UUID]


class Me(CamelModel):
    user_id: str
    username: str | None
    avatar_url: str
    default_avatar_url: str
    is_admin: bool
    owned_bots: list[OwnedBot]


@router.get("")
def get_me(user: LoggedInUser, db: Database) -> Me:
    rows = db.execute(
        """
        SELECT b.id, b.name, ARRAY(
            SELECT c.id FROM currencies c WHERE c.bot_id = b.id AND c.removed_at IS NULL ORDER BY c.abbreviation
        ) AS currency_ids
        FROM bots b
        WHERE b.owner_id = %s AND b.removed_at IS NULL
        ORDER BY b.name, b.id
        """,
        (user.id,),
    ).fetchall()

    return Me(
        user_id=user.id,
        username=user.username,
        avatar_url=avatar_url(user.id, user.avatar_hash),
        default_avatar_url=default_avatar_url(user.id),
        is_admin=user.is_admin,
        owned_bots=[OwnedBot.model_validate(row) for row in rows],
    )


@router.get("/transactions")
def get_my_transactions(user: LoggedInUser, page: PageQuery, db: Database) -> list[Transaction]:
    return list_user_transactions(db, user.id, page)
