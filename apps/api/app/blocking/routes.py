from fastapi import APIRouter

from app.auth.sessions import AdminUser, LoggedInUser
from app.blocking.service import (
    GLOBAL,
    BlockedUser,
    BlockRequest,
    BlockResult,
    PreviewRequest,
    block_user,
    currency_scope,
    list_blocks,
    preview_block,
    unblock_user,
)
from app.core.database import Database, Now
from app.owners.access import OwnedCurrencyId
from app.transactions.models import Transaction

router = APIRouter(tags=["blocking"])


@router.get("/currencies/{currency_id}/blocks")
def get_currency_blocks(currency_id: OwnedCurrencyId, db: Database) -> list[BlockedUser]:
    return list_blocks(db, currency_scope(currency_id))


@router.post("/currencies/{currency_id}/blocks/preview")
def preview_currency_block(
    currency_id: OwnedCurrencyId, body: PreviewRequest, db: Database, now: Now
) -> list[Transaction]:
    return preview_block(db, currency_scope(currency_id), body, now)


@router.post("/currencies/{currency_id}/blocks", status_code=201)
def block_for_currency(
    currency_id: OwnedCurrencyId, body: BlockRequest, user: LoggedInUser, db: Database, now: Now
) -> BlockResult:
    return block_user(db, currency_scope(currency_id), body, user.id, now)


@router.delete("/currencies/{currency_id}/blocks/{user_id}", status_code=204)
def unblock_for_currency(
    currency_id: OwnedCurrencyId, user_id: str, user: LoggedInUser, db: Database, now: Now
) -> None:
    unblock_user(db, currency_scope(currency_id), user_id, user.id, now)


@router.get("/admin/blocks")
def get_global_blocks(admin: AdminUser, db: Database) -> list[BlockedUser]:
    return list_blocks(db, GLOBAL)


@router.post("/admin/blocks/preview")
def preview_global_block(admin: AdminUser, body: PreviewRequest, db: Database, now: Now) -> list[Transaction]:
    return preview_block(db, GLOBAL, body, now)


@router.post("/admin/blocks", status_code=201)
def block_everywhere(admin: AdminUser, body: BlockRequest, db: Database, now: Now) -> BlockResult:
    return block_user(db, GLOBAL, body, admin.id, now)


@router.delete("/admin/blocks/{user_id}", status_code=204)
def unblock_everywhere(admin: AdminUser, user_id: str, db: Database, now: Now) -> None:
    unblock_user(db, GLOBAL, user_id, admin.id, now)
