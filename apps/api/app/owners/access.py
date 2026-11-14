from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.auth.sessions import LoggedInUser
from app.core.database import Database
from app.core.errors import ApiError, not_found


def owned_currency_id(currency_id: UUID, user: LoggedInUser, db: Database) -> UUID:
    require_owner(db, currency_id, user.id)

    return currency_id


def require_owner(db: Database, currency_id: UUID, user_id: str) -> None:
    row = db.execute("SELECT owner_id FROM currencies WHERE id = %s", (currency_id,)).fetchone()
    if row is None:
        raise not_found("currency")

    if row["owner_id"] != user_id:
        raise ApiError(403, "You don't own that currency.")


OwnedCurrencyId = Annotated[UUID, Depends(owned_currency_id)]
