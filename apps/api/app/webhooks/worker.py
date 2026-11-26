import logging
import signal
import threading
from datetime import UTC, datetime

import httpx
import psycopg
from psycopg.rows import dict_row

from app.bots.feed import purge_expired_events
from app.core.config import require_environment_variable
from app.core.logs import configure_logging
from app.core.secret_box import SecretBox
from app.webhooks.delivery import WebhookSender, deliver_due_webhooks
from app.webhooks.public_transport import PublicAddressTransport

POLL_SECONDS = 2
WEBHOOK_TIMEOUT_SECONDS = 10

logger = logging.getLogger("discoin.worker")


def run(database_url: str, box: SecretBox, stop: threading.Event) -> None:
    transport = PublicAddressTransport()
    with (
        psycopg.connect(database_url, autocommit=True, row_factory=dict_row) as db,
        httpx.Client(transport=transport, timeout=WEBHOOK_TIMEOUT_SECONDS, follow_redirects=False) as http,
    ):
        sender = WebhookSender(http, box)

        while not stop.is_set():
            attempted = deliver_due_webhooks(db, sender, datetime.now(UTC))
            if attempted:
                logger.info("webhooks attempted", extra={"attempted": attempted})

            purge_expired_events(db, datetime.now(UTC))
            stop.wait(POLL_SECONDS)


def main() -> None:
    configure_logging()
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    database_url = require_environment_variable("DATABASE_URL")
    box = SecretBox.from_base64(require_environment_variable("WEBHOOK_SECRET_KEY"))

    run(database_url, box, stop)


if __name__ == "__main__":
    main()
