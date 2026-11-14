import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import psycopg
from psycopg import Connection

from app.core.config import require_discord_id, require_environment_variable
from app.currencies.curve import floor2
from app.currencies.queries import record_history

HISTORY_DAYS = 30
RESERVE_PER_WEEKLY_MEDIAN = 4
WAVE_FREQUENCY = 0.7


@dataclass(frozen=True)
class SampleCurrency:
    id: UUID
    abbreviation: str
    name: str
    weekly_median: Decimal
    drift: float
    wave: float
    phase: float


SAMPLE_CURRENCIES = (
    SampleCurrency(UUID("019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21"), "OAT", "Oats", Decimal(260_000), -0.06, 0.02, 0.4),
    SampleCurrency(UUID("019a6f10-5e88-7c02-9a4d-13b7e2f06c95"), "PBL", "Pebbles", Decimal(880_000), 0.04, 0.015, 2.1),
    SampleCurrency(UUID("019a6f11-0b13-7e9f-a6c8-74d1f3a95e07"), "SCR", "Scrap", Decimal(3_700_000), -0.09, 0.025, 4.3),
    SampleCurrency(UUID("019a6f11-7d56-7a11-b3e5-0c98a4d72f6b"), "GEM", "Gems", Decimal(20_000), 0, 0, 0),
    SampleCurrency(UUID("019a6f12-3a9c-7f45-8e70-b6215d0c3a18"), "TKT", "Tickets", Decimal(98_000), 0.11, 0.03, 1.2),
)


def seed_sample_currencies(db: Connection, owner_id: str, now: datetime) -> list[str]:
    seeded = []

    for sample in SAMPLE_CURRENCIES:
        if insert_sample(db, sample, owner_id, now):
            seeded.append(sample.abbreviation)

    return seeded


def insert_sample(db: Connection, sample: SampleCurrency, owner_id: str, now: datetime) -> bool:
    history = sample_reserves(sample)
    inserted = db.execute(
        """
        INSERT INTO currencies (id, name, abbreviation, owner_id, reserve, weekly_median)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        (sample.id, sample.name, sample.abbreviation, owner_id, history[-1], sample.weekly_median),
    ).fetchone()
    if inserted is None:
        return False

    for day, reserve in enumerate(history):
        record_history(db, sample.id, reserve, now - timedelta(days=HISTORY_DAYS - day))

    return True


def sample_reserves(sample: SampleCurrency) -> list[Decimal]:
    starting = sample.weekly_median * RESERVE_PER_WEEKLY_MEDIAN

    return [floor2(starting * Decimal(math.exp(reserve_offset(sample, day)))) for day in range(HISTORY_DAYS + 1)]


def reserve_offset(sample: SampleCurrency, day: int) -> float:
    return sample.drift * day / HISTORY_DAYS + sample.wave * math.sin(day * WAVE_FREQUENCY + sample.phase)


def main() -> None:
    database_url = require_environment_variable("DATABASE_URL")
    owner_id = require_discord_id("SEED_OWNER_ID")

    with psycopg.connect(database_url) as db:
        seeded = seed_sample_currencies(db, owner_id, datetime.now(UTC))

    print(f"Seeded {len(seeded)} sample currencies: {', '.join(seeded) or 'none, they already exist'}")


if __name__ == "__main__":
    main()
