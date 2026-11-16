import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row

from app.core.config import require_discord_id, require_environment_variable
from app.currencies.curve import floor2
from app.currencies.queries import record_history

HISTORY_DAYS = 30
SAMPLE_MULTIPLIER = Decimal(4)
WAVE_FREQUENCY = 0.7
ALREADY_EXISTS = "it already exists"
BOT_REMOVED = "an admin removed its sample bot"
CURRENCY_REMOVED = "an admin removed it"


@dataclass(frozen=True)
class SampleBot:
    id: UUID
    discord_id: str


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

SAMPLE_BOTS = {
    "OAT": SampleBot(UUID("019a8b20-1a01-7c10-9e01-6a1b2c3d4e01"), "990000000000000001"),
    "PBL": SampleBot(UUID("019a8b20-1a02-7c10-9e02-6a1b2c3d4e02"), "990000000000000002"),
    "SCR": SampleBot(UUID("019a8b20-1a03-7c10-9e03-6a1b2c3d4e03"), "990000000000000003"),
    "GEM": SampleBot(UUID("019a8b20-1a04-7c10-9e04-6a1b2c3d4e04"), "990000000000000004"),
    "TKT": SampleBot(UUID("019a8b20-1a05-7c10-9e05-6a1b2c3d4e05"), "990000000000000005"),
}


@dataclass(frozen=True)
class SeedResult:
    seeded: list[str]
    skipped: dict[str, str]


def seed_sample_currencies(db: Connection, owner_id: str, now: datetime) -> SeedResult:
    result = SeedResult(seeded=[], skipped={})

    for sample in SAMPLE_CURRENCIES:
        insert_sample_bot(db, sample, owner_id)

        skip_reason = seed_sample(db, sample, now)
        if skip_reason is None:
            result.seeded.append(sample.abbreviation)
        else:
            result.skipped[sample.abbreviation] = skip_reason

    return result


def seed_sample(db: Connection, sample: SampleCurrency, now: datetime) -> str | None:
    removal = removal_reason(db, sample)
    if removal is not None:
        return removal

    if insert_sample(db, sample, now):
        return None

    return ALREADY_EXISTS


def removal_reason(db: Connection, sample: SampleCurrency) -> str | None:
    row = (
        db.cursor(row_factory=dict_row)
        .execute(
            """
            SELECT
                (SELECT removed_at IS NOT NULL FROM bots WHERE id = %s) AS bot_removed,
                (SELECT removed_at IS NOT NULL FROM currencies WHERE id = %s) AS currency_removed
            """,
            (SAMPLE_BOTS[sample.abbreviation].id, sample.id),
        )
        .fetchone()
    )
    if row["bot_removed"]:
        return BOT_REMOVED

    if row["currency_removed"]:
        return CURRENCY_REMOVED

    return None


def insert_sample_bot(db: Connection, sample: SampleCurrency, owner_id: str) -> None:
    bot = SAMPLE_BOTS[sample.abbreviation]
    db.execute(
        "INSERT INTO bots (id, name, discord_id, owner_id) VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
        (bot.id, f"{sample.name} bot", bot.discord_id, owner_id),
    )


def insert_sample(db: Connection, sample: SampleCurrency, now: datetime) -> bool:
    history = sample_reserves(sample)

    inserted = db.execute(
        """
        INSERT INTO currencies (id, name, abbreviation, bot_id, reserve, weekly_median, multiplier)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        (
            sample.id,
            sample.name,
            sample.abbreviation,
            SAMPLE_BOTS[sample.abbreviation].id,
            history[-1],
            sample.weekly_median,
            SAMPLE_MULTIPLIER,
        ),
    ).fetchone()
    if inserted is None:
        return False

    for day, reserve in enumerate(history):
        record_history(db, sample.id, reserve, now - timedelta(days=HISTORY_DAYS - day))

    return True


def sample_reserves(sample: SampleCurrency) -> list[Decimal]:
    starting = sample.weekly_median * SAMPLE_MULTIPLIER

    return [floor2(starting * Decimal(math.exp(reserve_offset(sample, day)))) for day in range(HISTORY_DAYS + 1)]


def reserve_offset(sample: SampleCurrency, day: int) -> float:
    return sample.drift * day / HISTORY_DAYS + sample.wave * math.sin(day * WAVE_FREQUENCY + sample.phase)


def main() -> None:
    database_url = require_environment_variable("DATABASE_URL")
    owner_id = require_discord_id("SEED_OWNER_ID")

    with psycopg.connect(database_url) as db:
        result = seed_sample_currencies(db, owner_id, datetime.now(UTC))

    print(f"Seeded {len(result.seeded)} sample currencies: {', '.join(result.seeded) or 'none'}")

    for abbreviation, reason in result.skipped.items():
        print(f"Skipped {abbreviation} because {reason}.")


if __name__ == "__main__":
    main()
