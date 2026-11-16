from fastapi import APIRouter

from app.auth.sessions import AdminUser
from app.blocking.service import (
    GLOBAL,
    BlockedUser,
    BlockRequest,
    BlockResult,
    PreviewRequest,
    block_user,
    list_blocks,
    owner_scope,
    preview_block,
    unblock_user,
)
from app.core.database import Database, Now
from app.owners.access import OwnedBot, OwnedBotForWrite
from app.transactions.models import Transaction

router = APIRouter(tags=["blocking"])


@router.get("/bots/{bot_id}/blocks")
def get_bot_blocks(owned: OwnedBot, db: Database) -> list[BlockedUser]:
    return list_blocks(db, owner_scope(owned))


@router.post("/bots/{bot_id}/blocks/preview")
def preview_bot_block(owned: OwnedBot, body: PreviewRequest, db: Database, now: Now) -> list[Transaction]:
    return preview_block(db, owner_scope(owned), body, now)


@router.post("/bots/{bot_id}/blocks", status_code=201)
def block_for_bot(owned: OwnedBotForWrite, body: BlockRequest, db: Database, now: Now) -> BlockResult:
    return block_user(db, owner_scope(owned), body, owned.owner_id, now)


@router.delete("/bots/{bot_id}/blocks/{user_id}", status_code=204)
def unblock_for_bot(owned: OwnedBotForWrite, user_id: str, db: Database, now: Now) -> None:
    unblock_user(db, owner_scope(owned), user_id, owned.owner_id, now)


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
