from contextlib import AbstractContextManager
from dataclasses import dataclass
from uuid import UUID, uuid7

from fastapi import APIRouter
from psycopg import Connection
from psycopg.rows import DictRow

from app.admin.removal import RemovalPreview, preview_bot_removal, remove_bot, revoke_credentials
from app.auth.sessions import AdminUser
from app.core.database import Database, Now, unique_as_field_error
from app.core.errors import ApiError, not_found
from app.core.models import CamelModel
from app.core.validation import checked_discord_id, checked_text, require_sent_values

DISCORD_ID_INDEX = "bots_discord_id"
OWNER_CHANGED = "The bot changed owner."
BOT_FIELDS = {
    "name": ("name", "bot name"),
    "discord_id": ("discordId", "bot's Discord ID"),
    "owner_id": ("ownerId", "owner ID"),
}

router = APIRouter(prefix="/bots")


class Bot(CamelModel):
    id: UUID
    name: str
    discord_id: str
    owner_id: str
    currency_count: int


class NewBot(CamelModel):
    name: str
    discord_id: str
    owner_id: str


class BotChanges(CamelModel):
    name: str | None = None
    discord_id: str | None = None
    owner_id: str | None = None


@dataclass(frozen=True)
class BotDetails:
    name: str
    discord_id: str
    owner_id: str


BOT_QUERY = """
    SELECT b.id, b.name, b.discord_id, b.owner_id,
        (SELECT count(*) FROM currencies c WHERE c.bot_id = b.id AND c.removed_at IS NULL) AS currency_count
    FROM bots b
    WHERE b.removed_at IS NULL
"""


@router.get("")
def get_bots(admin: AdminUser, db: Database) -> list[Bot]:
    rows = db.execute(f"{BOT_QUERY} ORDER BY b.name, b.id").fetchall()

    return [Bot.model_validate(row) for row in rows]


@router.post("", status_code=201)
def add_bot(admin: AdminUser, body: NewBot, db: Database) -> Bot:
    details = checked_bot_details(db, body, None)
    bot_id = uuid7()
    with claiming_discord_id():
        db.execute(
            "INSERT INTO bots (id, name, discord_id, owner_id) VALUES (%s, %s, %s, %s)",
            (bot_id, details.name, details.discord_id, details.owner_id),
        )

    return find_bot(db, bot_id)


@router.patch("/{bot_id}")
def update_bot(bot_id: UUID, admin: AdminUser, body: BotChanges, db: Database) -> Bot:
    require_sent_values(body, BOT_FIELDS)

    if not body.model_fields_set:
        raise ApiError(400, "Change the name, the Discord ID or the owner before saving.")

    stored = lock_bot(db, bot_id)
    details = checked_bot_details(db, merged_changes(body, stored), bot_id)
    with claiming_discord_id():
        db.execute(
            "UPDATE bots SET name = %s, discord_id = %s, owner_id = %s WHERE id = %s",
            (details.name, details.discord_id, details.owner_id, bot_id),
        )

    if details.owner_id != stored["owner_id"]:
        revoke_credentials(db, bot_id, OWNER_CHANGED)

    return find_bot(db, bot_id)


@router.get("/{bot_id}/removal")
def get_bot_removal(bot_id: UUID, admin: AdminUser, db: Database) -> RemovalPreview:
    return preview_bot_removal(db, bot_id)


@router.delete("/{bot_id}", status_code=204)
def delete_bot(bot_id: UUID, admin: AdminUser, db: Database, now: Now) -> None:
    remove_bot(db, bot_id, now)


def merged_changes(body: BotChanges, stored: DictRow) -> NewBot:
    return NewBot(
        name=stored["name"] if body.name is None else body.name,
        discord_id=stored["discord_id"] if body.discord_id is None else body.discord_id,
        owner_id=stored["owner_id"] if body.owner_id is None else body.owner_id,
    )


def checked_bot_details(db: Connection[DictRow], bot: NewBot, excluding_id: UUID | None) -> BotDetails:
    details = BotDetails(
        name=checked_text(bot.name, "name", "bot name"),
        discord_id=checked_discord_id(bot.discord_id, "discordId"),
        owner_id=checked_discord_id(bot.owner_id, "ownerId"),
    )
    if discord_id_in_use(db, details.discord_id, excluding_id):
        raise discord_id_taken()

    return details


def discord_id_in_use(db: Connection[DictRow], discord_id: str, excluding_id: UUID | None) -> bool:
    row = db.execute(
        "SELECT 1 FROM bots WHERE discord_id = %s AND id IS DISTINCT FROM %s AND removed_at IS NULL",
        (discord_id, excluding_id),
    ).fetchone()

    return row is not None


def discord_id_taken() -> ApiError:
    return ApiError(409, "Another bot already has that Discord ID.", "discordId")


def claiming_discord_id() -> AbstractContextManager[None]:
    return unique_as_field_error(DISCORD_ID_INDEX, discord_id_taken())


def lock_bot(db: Connection[DictRow], bot_id: UUID) -> DictRow:
    row = db.execute(
        "SELECT name, discord_id, owner_id FROM bots WHERE id = %s AND removed_at IS NULL FOR NO KEY UPDATE", (bot_id,)
    ).fetchone()
    if row is None:
        raise not_found("bot")

    return row


def find_bot(db: Connection[DictRow], bot_id: UUID) -> Bot:
    return Bot.model_validate(db.execute(f"{BOT_QUERY} AND b.id = %s", (bot_id,)).fetchone())
