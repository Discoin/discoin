import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.core.validation import DISCORD_ID_PATTERN

FIRST_ADMIN_IDS = "FIRST_ADMIN_IDS"
LIST_SEPARATOR = ","
ENTRY_PADDING = " \t"
DISCORD_ID_LIST_EXPECTATION = "a comma separated list of Discord user IDs of 17 to 20 digits"


class MissingSettingError(RuntimeError):
    def __init__(self, name: str) -> None:
        super().__init__(f"Required environment variable {name} is not set")
        self.name = name


class InvalidSettingError(RuntimeError):
    def __init__(self, name: str, expected: str) -> None:
        super().__init__(f"Environment variable {name} must be {expected}")
        self.name = name


@dataclass(frozen=True)
class Settings:
    database_url: str
    first_admin_ids: tuple[str, ...]
    discord_client_id: str
    discord_client_secret: str
    discord_redirect_uri: str
    frontend_url: str
    webhook_secret_key: str

    @property
    def frontend_origin(self) -> str:
        parts = urlsplit(self.frontend_url)

        return f"{parts.scheme}://{parts.netloc}"

    @classmethod
    def from_environment(cls) -> Settings:
        return cls(
            database_url=require_environment_variable("DATABASE_URL"),
            first_admin_ids=require_discord_id_list(FIRST_ADMIN_IDS),
            discord_client_id=require_environment_variable("DISCORD_CLIENT_ID"),
            discord_client_secret=require_environment_variable("DISCORD_CLIENT_SECRET"),
            discord_redirect_uri=require_url("DISCORD_REDIRECT_URI"),
            frontend_url=require_url("FRONTEND_URL"),
            webhook_secret_key=require_environment_variable("WEBHOOK_SECRET_KEY"),
        )


def require_environment_variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise MissingSettingError(name)

    return value


def require_discord_id(name: str) -> str:
    value = require_environment_variable(name)
    if not DISCORD_ID_PATTERN.match(value):
        raise InvalidSettingError(name, "a Discord user ID of 17 to 20 digits")

    return value


def require_discord_id_list(name: str) -> tuple[str, ...]:
    value = require_environment_variable(name)
    entries = tuple(entry.strip(ENTRY_PADDING) for entry in value.split(LIST_SEPARATOR))

    problem = find_discord_id_list_problem(entries)
    if problem:
        raise InvalidSettingError(name, f"{DISCORD_ID_LIST_EXPECTATION}, but {problem}")

    return entries


def find_discord_id_list_problem(entries: tuple[str, ...]) -> str | None:
    for index, entry in enumerate(entries):
        position = index + 1

        if not entry:
            return f"entry {position} is empty"

        if not DISCORD_ID_PATTERN.fullmatch(entry):
            return f"entry {position} ({entry!r}) is not one"

        if entry in entries[:index]:
            return f"entry {position} repeats {entry}"

    return None


def require_url(name: str) -> str:
    value = require_environment_variable(name)
    if not value.startswith(("https://", "http://")):
        raise InvalidSettingError(name, "a full http:// or https:// URL")

    return value
