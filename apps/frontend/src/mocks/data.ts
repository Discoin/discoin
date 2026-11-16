import type {
  AdminUser,
  BlockedUser,
  Currency,
  CurrencyName,
  ReservePoint,
  TransactionRecord,
  TransactionStatus,
} from "../api/types.js";
import {
  calculatePayout,
  currencyValue,
  floorToCents,
} from "../lib/exchange.js";

const HISTORY_DAYS = 30;
const SPARKLINE_POINTS = 8;
const DAY_MS = 86_400_000;
const WAVE_FREQUENCY = 0.7;
const HISTORY_END = Date.parse("2026-11-13T00:00:00Z");
const SEED_MULTIPLIER = 4;

interface CurrencySeed {
  id: string;
  abbreviation: string;
  name: string;
  reserve: number;
  weeklyMedian: number;
  drift: number;
  wave: number;
  phase: number;
}

const CURRENCY_SEEDS: CurrencySeed[] = [
  {
    id: "019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21",
    abbreviation: "OAT",
    name: "Oats",
    reserve: 1_000_000,
    weeklyMedian: 260_000,
    drift: -0.06,
    wave: 0.02,
    phase: 0.4,
  },
  {
    id: "019a6f10-5e88-7c02-9a4d-13b7e2f06c95",
    abbreviation: "PBL",
    name: "Pebbles",
    reserve: 3_571_428.57,
    weeklyMedian: 880_000,
    drift: 0.04,
    wave: 0.015,
    phase: 2.1,
  },
  {
    id: "019a6f11-0b13-7e9f-a6c8-74d1f3a95e07",
    abbreviation: "SCR",
    name: "Scrap",
    reserve: 14_285_714.29,
    weeklyMedian: 3_700_000,
    drift: -0.09,
    wave: 0.025,
    phase: 4.3,
  },
  {
    id: "019a6f11-7d56-7a11-b3e5-0c98a4d72f6b",
    abbreviation: "GEM",
    name: "Gems",
    reserve: 80_000,
    weeklyMedian: 20_000,
    drift: 0,
    wave: 0,
    phase: 0,
  },
  {
    id: "019a6f12-3a9c-7f45-8e70-b6215d0c3a18",
    abbreviation: "TKT",
    name: "Tickets",
    reserve: 420_000,
    weeklyMedian: 98_000,
    drift: 0.11,
    wave: 0.03,
    phase: 1.2,
  },
];

function reserveOffset(seed: CurrencySeed, day: number): number {
  return (
    (seed.drift * day) / HISTORY_DAYS +
    seed.wave * Math.sin(day * WAVE_FREQUENCY + seed.phase)
  );
}

function reserveHistory(seed: CurrencySeed): ReservePoint[] {
  const todayOffset = reserveOffset(seed, HISTORY_DAYS);
  const days = Array.from({ length: HISTORY_DAYS + 1 }, (_, day) => day);

  return days.map((day) => ({
    at: new Date(HISTORY_END - (HISTORY_DAYS - day) * DAY_MS).toISOString(),
    reserve: floorToCents(
      seed.reserve * Math.exp(reserveOffset(seed, day) - todayOffset),
    ),
  }));
}

function toCurrency(seed: CurrencySeed, history: ReservePoint[]): Currency {
  const values = history.map((point) => currencyValue(point.reserve));
  const today = values[values.length - 1];
  const yesterday = values[values.length - 2];

  return {
    id: seed.id,
    abbreviation: seed.abbreviation,
    name: seed.name,
    reserve: seed.reserve,
    active: true,
    change24h: today / yesterday - 1,
    valueHistory: values.slice(-SPARKLINE_POINTS),
  };
}

export const sampleReserveHistories: Record<string, ReservePoint[]> =
  Object.fromEntries(
    CURRENCY_SEEDS.map((seed) => [seed.id, reserveHistory(seed)]),
  );

export const sampleCurrencies: Currency[] = CURRENCY_SEEDS.map((seed) =>
  toCurrency(seed, sampleReserveHistories[seed.id]),
);

export const sampleWeeklyMedians: Record<string, number> = Object.fromEntries(
  CURRENCY_SEEDS.map((seed) => [seed.id, seed.weeklyMedian]),
);

export const sampleMultipliers: Record<string, number> = Object.fromEntries(
  CURRENCY_SEEDS.map((seed) => [seed.id, SEED_MULTIPLIER]),
);

const [OATS, PEBBLES, SCRAP, GEMS, TICKETS] = sampleCurrencies;

const CURRENT_USER_ID = "412358906715234305";
const TRADER_ID = "530917284650193847";
const OTHER_TRADER_ID = "829304715620394857";

export interface RemovedCurrency extends CurrencyName {
  reserve: number;
}

const CORN: RemovedCurrency = {
  id: "0199a0b4-6e21-7c3a-9d50-3f81c2a7e9b4",
  abbreviation: "CRN",
  name: "Corn",
  reserve: 640_000,
};

export const sampleRemovedCurrencies: RemovedCurrency[] = [CORN];

interface TransactionSeed {
  id: string;
  senderId: string;
  from: Pick<Currency, "id" | "reserve">;
  to: Pick<Currency, "id" | "reserve">;
  amount: number;
  status: TransactionStatus;
  submittedAt: string;
  handledAt: string | null;
}

function toTransaction(seed: TransactionSeed): TransactionRecord {
  return {
    id: seed.id,
    fromCurrencyId: seed.from.id,
    toCurrencyId: seed.to.id,
    amount: seed.amount,
    payout: calculatePayout(seed.amount, {
      from: seed.from.reserve,
      to: seed.to.reserve,
    }),
    status: seed.status,
    submittedAt: seed.submittedAt,
    handledAt: seed.handledAt,
  };
}

const TRANSACTION_SEEDS: TransactionSeed[] = [
  {
    id: "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4",
    senderId: CURRENT_USER_ID,
    from: SCRAP,
    to: OATS,
    amount: 25_000,
    status: "Pending",
    submittedAt: "2026-11-12T22:41:09Z",
    handledAt: null,
  },
  {
    id: "019a7c2f-91d0-7c66-8b14-f5a03e7d2c90",
    senderId: TRADER_ID,
    from: PEBBLES,
    to: OATS,
    amount: 10_000,
    status: "Completed",
    submittedAt: "2026-11-12T21:58:44Z",
    handledAt: "2026-11-12T21:58:51Z",
  },
  {
    id: "019a7c1b-44e7-7f20-8a31-9d5c2b70e6f8",
    senderId: OTHER_TRADER_ID,
    from: GEMS,
    to: TICKETS,
    amount: 40,
    status: "Pending",
    submittedAt: "2026-11-12T21:12:30Z",
    handledAt: null,
  },
  {
    id: "019a7bd4-07a9-7e15-b6c2-58f31d9a4e70",
    senderId: CURRENT_USER_ID,
    from: OATS,
    to: SCRAP,
    amount: 1_500,
    status: "Completed",
    submittedAt: "2026-11-12T20:47:02Z",
    handledAt: "2026-11-12T20:47:06Z",
  },
  {
    id: "019a7b88-0e4a-7d93-a2c7-6c19b8f4e035",
    senderId: CURRENT_USER_ID,
    from: TICKETS,
    to: GEMS,
    amount: 1_200,
    status: "Refunded",
    submittedAt: "2026-11-12T18:03:27Z",
    handledAt: "2026-11-12T18:05:02Z",
  },
  {
    id: "019a7b62-d3f8-7a40-9e17-2b6c80f5a1d3",
    senderId: OTHER_TRADER_ID,
    from: PEBBLES,
    to: OATS,
    amount: 8_800,
    status: "Pending",
    submittedAt: "2026-11-12T17:30:51Z",
    handledAt: null,
  },
  {
    id: "019a7b10-6c25-7b88-8f4a-e07d3c91b52a",
    senderId: TRADER_ID,
    from: SCRAP,
    to: TICKETS,
    amount: 32_000,
    status: "Completed",
    submittedAt: "2026-11-12T15:16:40Z",
    handledAt: "2026-11-12T15:16:43Z",
  },
  {
    id: "019a7a51-c7f2-7b08-9d5e-31a6f0c8e7b4",
    senderId: CURRENT_USER_ID,
    from: SCRAP,
    to: PEBBLES,
    amount: 50_000,
    status: "Cancelled",
    submittedAt: "2026-11-12T12:20:15Z",
    handledAt: "2026-11-12T12:31:40Z",
  },
  {
    id: "019a79e8-1a6d-7c53-a2f9-4b8e06d7c31f",
    senderId: TRADER_ID,
    from: OATS,
    to: GEMS,
    amount: 600,
    status: "Completed",
    submittedAt: "2026-11-12T09:05:18Z",
    handledAt: "2026-11-12T09:05:24Z",
  },
  {
    id: "0199a1f0-3c55-7e21-9b40-6d2e81c7a5f3",
    senderId: TRADER_ID,
    from: TICKETS,
    to: OATS,
    amount: 2_000,
    status: "Completed",
    submittedAt: "2026-09-01T10:12:05Z",
    handledAt: "2026-09-01T10:12:09Z",
  },
  {
    id: "01998f2a-4b70-7d19-8e36-c5a07b2d1f68",
    senderId: TRADER_ID,
    from: CORN,
    to: TICKETS,
    amount: 3_000,
    status: "Completed",
    submittedAt: "2026-08-20T16:40:12Z",
    handledAt: "2026-08-20T16:40:15Z",
  },
];

export const sampleTransactions: TransactionRecord[] =
  TRANSACTION_SEEDS.map(toTransaction);

export const sampleTransactionSenders: Record<string, string> =
  Object.fromEntries(TRANSACTION_SEEDS.map((seed) => [seed.id, seed.senderId]));

export const sampleCurrentUser: AdminUser = {
  userId: CURRENT_USER_ID,
  username: "coinkeeper",
};

export interface MockBot {
  id: string;
  name: string;
  discordId: string;
  ownerId: string;
  hasApiToken: boolean;
  hasWebhookSecret: boolean;
  webhookUrl: string | null;
}

const ROCK_OWNER_ID = "305918264730192845";
const SPARE_OWNER_ID = "640281937465019283";

const OAT_BOT: MockBot = {
  id: "019a8b20-1a01-7c10-9e01-6a1b2c3d4e01",
  name: "Harvest bot",
  discordId: "990000000000000001",
  ownerId: CURRENT_USER_ID,
  hasApiToken: true,
  hasWebhookSecret: true,
  webhookUrl: "https://oats-bot.example.com/discoin",
};

const TICKET_BOT: MockBot = {
  id: "019a8b20-1a05-7c10-9e05-6a1b2c3d4e05",
  name: "Ticket bot",
  discordId: "990000000000000005",
  ownerId: CURRENT_USER_ID,
  hasApiToken: false,
  hasWebhookSecret: false,
  webhookUrl: null,
};

const ROCK_BOT: MockBot = {
  id: "019a8b20-1a02-7c10-9e02-6a1b2c3d4e02",
  name: "Rock bot",
  discordId: "990000000000000002",
  ownerId: ROCK_OWNER_ID,
  hasApiToken: true,
  hasWebhookSecret: false,
  webhookUrl: null,
};

const SPARE_BOT: MockBot = {
  id: "019a8b20-1a04-7c10-9e04-6a1b2c3d4e04",
  name: "Spare bot",
  discordId: "990000000000000004",
  ownerId: SPARE_OWNER_ID,
  hasApiToken: false,
  hasWebhookSecret: false,
  webhookUrl: null,
};

export const sampleBots: MockBot[] = [OAT_BOT, ROCK_BOT, SPARE_BOT, TICKET_BOT];

export const sampleBotIds: Record<string, string | null> = {
  [OATS.id]: OAT_BOT.id,
  [PEBBLES.id]: ROCK_BOT.id,
  [SCRAP.id]: OAT_BOT.id,
  [GEMS.id]: null,
  [TICKETS.id]: TICKET_BOT.id,
};

export const sampleDailyCaps: Record<string, number | null> = {
  [OATS.id]: 5_000,
  [PEBBLES.id]: null,
  [SCRAP.id]: null,
  [GEMS.id]: null,
  [TICKETS.id]: null,
};

export const sampleBotBlocks: Record<string, BlockedUser[]> = {
  [OAT_BOT.id]: [
    {
      userId: "293847561029384756",
      reason: "Farmed oats with an alt account.",
      blockedAt: "2026-11-02T14:22:10Z",
      level: "bot",
    },
  ],
  [TICKET_BOT.id]: [],
  [ROCK_BOT.id]: [],
  [SPARE_BOT.id]: [],
};

export const sampleCurrencyBlocks: Record<string, BlockedUser[]> = {
  [GEMS.id]: [
    {
      userId: "481920374650192837",
      reason: "Sent gems from stolen accounts.",
      blockedAt: "2026-10-30T09:12:44Z",
      level: "bot",
    },
  ],
};

export const sampleGlobalBlocks: BlockedUser[] = [
  {
    userId: "198273645019283746",
    reason: "Sold stolen accounts for Discoin.",
    blockedAt: "2026-10-21T08:41:55Z",
    level: "global",
  },
  {
    userId: "587261093847562019",
    reason: "Exploited a payout bug in several bots.",
    blockedAt: "2026-11-09T19:03:32Z",
    level: "global",
  },
];

export const sampleAdmins: AdminUser[] = [
  sampleCurrentUser,
  { userId: "176254983017264530", username: "ledgerbird" },
];
