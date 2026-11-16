from uuid import UUID

import httpx
from psycopg import Connection

from app.core.secret_box import SecretBox
from app.webhooks.delivery import WebhookSender
from tests.factories import WEBHOOK_SECRET_KEY, bot_of

HOOK_URL = "https://bot.example.com/discoin"
BOX = SecretBox.from_base64(WEBHOOK_SECRET_KEY)
TEST_SECRET = "whsec_test"
UNREADABLE_SEAL = "v1.AAAA"


def connect_webhook(connection: Connection, currency_id: UUID) -> str:
    bot_id = bot_of(connection, currency_id)
    save_webhook(connection, bot_id, BOX.seal(TEST_SECRET, str(bot_id)))

    return TEST_SECRET


def connect_unreadable_webhook(connection: Connection, currency_id: UUID) -> None:
    save_webhook(connection, bot_of(connection, currency_id), UNREADABLE_SEAL)


def save_webhook(connection: Connection, bot_id: UUID, sealed: str) -> None:
    connection.execute(
        "UPDATE bots SET webhook_url = %s, webhook_secret_sealed = %s WHERE id = %s", (HOOK_URL, sealed, bot_id)
    )


class Receiver:
    def __init__(self, statuses: list[int]) -> None:
        self.statuses = statuses
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]

        return httpx.Response(status)

    def sender(self) -> WebhookSender:
        return WebhookSender(httpx.Client(transport=httpx.MockTransport(self)), BOX)
