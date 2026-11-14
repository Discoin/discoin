import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DiscoinApi } from "../api/client.js";
import type { ReverseRequest } from "../api/types.js";
import { reservesAfterUndo } from "../lib/exchange.js";
import { createMockApi } from "./api.js";
import { sampleCurrencies } from "./data.js";
import { apiErrorOf, settle } from "./settle.js";

const [OATS, , , GEMS] = sampleCurrencies;
const NOW = new Date("2026-11-13T00:00:00Z");
const TRADER_ID = "530917284650193847";
const REASON = "Laundered coins through alts.";

const PEBBLES_INTO_OATS = "019a7c2f-91d0-7c66-8b14-f5a03e7d2c90";
const SCRAP_INTO_TICKETS = "019a7b10-6c25-7b88-8f4a-e07d3c91b52a";
const OATS_INTO_GEMS = "019a79e8-1a6d-7c53-a2f9-4b8e06d7c31f";
const TICKETS_INTO_OATS_IN_SEPTEMBER = "0199a1f0-3c55-7e21-9b40-6d2e81c7a5f3";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function adminPreview(reverse: ReverseRequest): Promise<string[]> {
  const preview = createMockApi().globalBlocks.previewBlock(
    TRADER_ID,
    REASON,
    reverse,
  );

  return (await settle(preview)).map((transaction) => transaction.id);
}

async function ownerPreview(reverse: ReverseRequest): Promise<string[]> {
  const preview = createMockApi()
    .currencyBlocks(OATS.id)
    .previewBlock(TRADER_ID, REASON, reverse);

  return (await settle(preview)).map((transaction) => transaction.id);
}

async function reserveOf(api: DiscoinApi, currencyId: string) {
  const currencies = await settle(api.listCurrencies());
  const found = currencies.find((candidate) => candidate.id === currencyId);
  if (found === undefined) throw new Error(`No currency ${currencyId}`);

  return found.reserve;
}

describe("admin reversal windows", () => {
  test("the last 24 hours lists the user's completed trades, newest first", async () => {
    expect(await adminPreview({ window: "24h" })).toEqual([
      PEBBLES_INTO_OATS,
      SCRAP_INTO_TICKETS,
      OATS_INTO_GEMS,
    ]);
  });

  test("30 days leaves out older trades", async () => {
    expect(await adminPreview({ window: "30d" })).not.toContain(
      TICKETS_INTO_OATS_IN_SEPTEMBER,
    );
  });

  test("all time includes every completed trade", async () => {
    expect(await adminPreview({ window: "all" })).toEqual([
      PEBBLES_INTO_OATS,
      SCRAP_INTO_TICKETS,
      OATS_INTO_GEMS,
      TICKETS_INTO_OATS_IN_SEPTEMBER,
    ]);
  });

  test("an admin block takes no direction", async () => {
    const error = await apiErrorOf(
      createMockApi().globalBlocks.previewBlock(TRADER_ID, REASON, {
        window: "all",
        direction: "both",
      }),
    );

    expect(error.status).toBe(400);
    expect(error.field).toBe("direction");
  });
});

describe("owner reversal directions", () => {
  test("incoming counts trades into the owner's currency", async () => {
    expect(
      await ownerPreview({ window: "all", direction: "incoming" }),
    ).toEqual([PEBBLES_INTO_OATS, TICKETS_INTO_OATS_IN_SEPTEMBER]);
  });

  test("outgoing counts trades out of the owner's currency", async () => {
    expect(
      await ownerPreview({ window: "all", direction: "outgoing" }),
    ).toEqual([OATS_INTO_GEMS]);
  });

  test("both leaves out trades that never touch the owner's currency", async () => {
    expect(await ownerPreview({ window: "all", direction: "both" })).toEqual([
      PEBBLES_INTO_OATS,
      OATS_INTO_GEMS,
      TICKETS_INTO_OATS_IN_SEPTEMBER,
    ]);
  });

  test("an owner block needs a direction", async () => {
    const error = await apiErrorOf(
      createMockApi()
        .currencyBlocks(OATS.id)
        .previewBlock(TRADER_ID, REASON, { window: "all" }),
    );

    expect(error.status).toBe(400);
    expect(error.field).toBe("direction");
  });
});

describe("blocking with a reversal", () => {
  test("marks each trade Reversed and runs it back through the curve", async () => {
    const api = createMockApi();
    const [trade] = (await settle(api.listRecentTransactions())).filter(
      (transaction) => transaction.id === OATS_INTO_GEMS,
    );
    const expected = reservesAfterUndo(trade.payout, {
      from: await reserveOf(api, OATS.id),
      to: await reserveOf(api, GEMS.id),
    });

    const { reversed } = await settle(
      api
        .currencyBlocks(OATS.id)
        .block(TRADER_ID, REASON, { window: "24h", direction: "outgoing" }),
    );

    expect(reversed.map((transaction) => transaction.status)).toEqual([
      "Reversed",
    ]);
    expect(await reserveOf(api, OATS.id)).toBe(expected.from);
    expect(await reserveOf(api, GEMS.id)).toBe(expected.to);
  });

  test("a refused block reverses nothing", async () => {
    const api = createMockApi();
    const before = await settle(api.listRecentTransactions());
    const error = await apiErrorOf(
      api.currencyBlocks(OATS.id).block(TRADER_ID, " ", {
        window: "all",
        direction: "both",
      }),
    );

    expect(error.field).toBe("reason");
    expect(await settle(api.listRecentTransactions())).toEqual(before);
    expect(await settle(api.currencyBlocks(OATS.id).list())).not.toContainEqual(
      expect.objectContaining({ userId: TRADER_ID }),
    );
  });

  test("without a reversal, completed trades stay completed", async () => {
    const api = createMockApi();
    const { reversed } = await settle(
      api.globalBlocks.block(TRADER_ID, REASON),
    );
    const trades = await settle(api.listRecentTransactions());

    expect(reversed).toEqual([]);
    expect(trades.map((transaction) => transaction.status)).not.toContain(
      "Reversed",
    );
  });
});
