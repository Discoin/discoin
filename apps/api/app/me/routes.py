from uuid import UUID

from fastapi import APIRouter

from app.auth.avatars import avatar_url
from app.auth.sessions import LoggedInUser
from app.core.database import Database
from app.core.models import CamelModel
from app.transactions.models import Transaction
from app.transactions.queries import PageQuery, list_user_transactions

router = APIRouter(prefix="/me", tags=["login"])


class Me(CamelModel):
    user_id: str
    username: str | None
    avatar_url: str
    is_admin: bool
    owned_currency_ids: list[UUID]


@router.get("")
def get_me(user: LoggedInUser, db: Database) -> Me:
    rows = db.execute("SELECT id FROM currencies WHERE owner_id = %s ORDER BY abbreviation", (user.id,)).fetchall()

    return Me(
        user_id=user.id,
        username=user.username,
        avatar_url=avatar_url(user.id, user.avatar_hash),
        is_admin=user.is_admin,
        owned_currency_ids=[row["id"] for row in rows],
    )


@router.get("/transactions")
def get_my_transactions(user: LoggedInUser, page: PageQuery, db: Database) -> list[Transaction]:
    return list_user_transactions(db, user.id, page)
