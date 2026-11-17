import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DiscoinApi } from "../api/client.js";
import type { TransactionRecord } from "../api/types.js";
import { createMockApi } from "./api.js";
import { sampleBots, sampleCurrentUser } from "./data.js";
import { apiErrorOf, settle } from "./settle.js";
import { publicTransaction } from "./transactionView.js";
import { MOCK_VIEWER_KEY } from "./viewer.js";

const [OAT_BOT, ROCK_BOT] = sampleBots;
const OAT_BOT_CANCEL = "01989c4e-2f10-7a3b-9c41-5d7e0b8a2f61";
const GLOBAL_CANCEL = "01987a31-8c52-7e04-a1f3-6b9d2c4e7a08";
const LIFTED_CANCEL = "019860d7-4a19-7c85-b2e6-0f3a9d1c5b74";
const OWN_PENDING_TRADE = "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4";
const COMPLETED_TRADE = "019a7c2f-91d0-7c66-8b14-f5a03e7d2c90";
const OAT_BOT_TRADER = "293847561029384756";
const GLOBAL_TRADER = "587261093847562019";
const OAT_BOT_OWNER = sampleCurrentUser.userId;
const ROCK_BOT_OWNER = "305918264730192845";
const ADMIN_ONLY = "176254983017264530";
const STRANGER = "700000000000000007";
const OAT_BOT_REASON = "Farmed oats with an alt account.";
const GLOBAL_REASON = "Exploited a payout bug in several bots.";
const NEW_BLOCKED_ID = "530917284650193847";
const PUBLIC_KEYS = [
  "amount",
  "fromCurrency",
  "fromCurrencyId",
  "handledAt",
  "id",
  "payout",
  "status",
  "submittedAt",
  "toCurrency",
  "toCurrencyId",
];
const HARVEST_BOT = { name: "Harvest bot", removed: false };
const GLOBAL_TRADERS_BOT = {
  name: "Side project bot",
  discordId: "990000000000000042",
  ownerId: GLOBAL_TRADER,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

function apiViewedBy(viewerId: string): DiscoinApi {
  sessionStorage.setItem(MOCK_VIEWER_KEY, viewerId);

  return createMockApi();
}

async function loggedOutApi(): Promise<DiscoinApi> {
  const api = createMockApi();
  await settle(api.logout());

  return api;
}

async function detailText(api: DiscoinApi, id: string): Promise<string> {
  return JSON.stringify(await settle(api.getTransaction(id)));
}

describe("public transactions", () => {
  test("are built from the public fields only, never by spreading the record", () => {
    const record = {
      id: COMPLETED_TRADE,
      fromCurrencyId: "pebbles",
      toCurrencyId: "oats",
      amount: 100,
      payout: 10,
      status: "Completed",
      submittedAt: "2026-11-12T21:58:44Z",
      handledAt: "2026-11-12T21:58:51Z",
      userId: OAT_BOT_TRADER,
    } as TransactionRecord;
    const label = { abbreviation: "OAT", name: "Oats", removed: false };

    const built = publicTransaction(record, () => label);

    expect(Object.keys(built).sort()).toEqual(PUBLIC_KEYS);
    expect(JSON.stringify(built)).not.toContain(OAT_BOT_TRADER);
  });

  test("every list item has exactly the public keys", async () => {
    const api = createMockApi();
    const lists = [
      await settle(api.listRecentTransactions()),
      await settle(api.listMyTransactions()),
    ];

    for (const item of lists.flat()) {
      expect(Object.keys(item).sort()).toEqual(PUBLIC_KEYS);
    }
  });
});

describe("one transaction", () => {
  test("an unknown ID is a 404", async () => {
    const error = await apiErrorOf(
      createMockApi().getTransaction("019a0000-0000-7000-8000-000000000000"),
    );

    expect(error.status).toBe(404);
    expect(error.message).toBe("No transaction with that ID.");
  });

  test.each([
    COMPLETED_TRADE.toUpperCase(),
    COMPLETED_TRADE.replace(/-/g, ""),
    `{${COMPLETED_TRADE}}`,
    `urn:uuid:${COMPLETED_TRADE}`,
  ])("accepts %s like the API does", async (id) => {
    const viewed = await settle(createMockApi().getTransaction(id));

    expect(viewed.id).toBe(COMPLETED_TRADE);
  });

  test("a malformed ID is a 400 on the ID field", async () => {
    const error = await apiErrorOf(createMockApi().getTransaction("nope"));

    expect(error.status).toBe(400);
    expect(error.field).toBe("transaction_id");
  });

  test("a logged out viewer gets only the public keys", async () => {
    const api = await loggedOutApi();
    const viewed = await settle(api.getTransaction(OAT_BOT_CANCEL));

    expect(Object.keys(viewed).sort()).toEqual(PUBLIC_KEYS);
    expect(JSON.stringify(viewed)).not.toContain(OAT_BOT_TRADER);
    expect(JSON.stringify(viewed)).not.toContain(OAT_BOT_REASON);
  });

  test("an unrelated logged in viewer gets only the public keys", async () => {
    const text = await detailText(apiViewedBy(STRANGER), OAT_BOT_CANCEL);

    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(PUBLIC_KEYS);
    expect(text).not.toContain(OAT_BOT_TRADER);
    expect(text).not.toContain(OAT_BOT_REASON);
  });

  test("the blocking bot's owner gets the user and the reason", async () => {
    const viewed = await settle(
      apiViewedBy(OAT_BOT_OWNER).getTransaction(OAT_BOT_CANCEL),
    );

    expect(viewed.userId).toBe(OAT_BOT_TRADER);
    expect(viewed.cause).toEqual({
      kind: "bot",
      bot: HARVEST_BOT,
      state: "active",
      reason: OAT_BOT_REASON,
    });
  });

  test.each([OAT_BOT_TRADER, ROCK_BOT_OWNER, ADMIN_ONLY])(
    "%s gets the user and the bot block without its reason",
    async (viewerId) => {
      const viewed = await settle(
        apiViewedBy(viewerId).getTransaction(OAT_BOT_CANCEL),
      );

      expect(viewed.userId).toBe(OAT_BOT_TRADER);
      expect(viewed.cause).toEqual({
        kind: "bot",
        bot: HARVEST_BOT,
        state: "active",
      });
    },
  );

  test.each([OAT_BOT_OWNER, ADMIN_ONLY])(
    "%s reads a site wide reason",
    async (viewerId) => {
      const viewed = await settle(
        apiViewedBy(viewerId).getTransaction(GLOBAL_CANCEL),
      );

      expect(viewed.cause).toEqual({
        kind: "global",
        state: "active",
        reason: GLOBAL_REASON,
      });
    },
  );

  test("a trading user with no other role reads no site wide reason", async () => {
    const viewed = await settle(
      apiViewedBy(GLOBAL_TRADER).getTransaction(GLOBAL_CANCEL),
    );

    expect(viewed.cause).toEqual({ kind: "global", state: "active" });
  });

  test("a trader who owns an unrelated live bot reads a site wide reason", async () => {
    const api = apiViewedBy(GLOBAL_TRADER);
    await settle(api.addBot(GLOBAL_TRADERS_BOT));

    const viewed = await settle(api.getTransaction(GLOBAL_CANCEL));

    expect(viewed.cause).toEqual({
      kind: "global",
      state: "active",
      reason: GLOBAL_REASON,
    });
  });

  test("a trader whose only bot is removed reads no site wide reason", async () => {
    const api = apiViewedBy(GLOBAL_TRADER);
    const added = await settle(api.addBot(GLOBAL_TRADERS_BOT));
    await settle(api.removeBot(added.id));

    const viewed = await settle(api.getTransaction(GLOBAL_CANCEL));

    expect(viewed.cause).toEqual({ kind: "global", state: "active" });
  });

  test("an owner of neither side who didn't trade gets the public keys", async () => {
    const viewed = await settle(
      apiViewedBy(ROCK_BOT_OWNER).getTransaction(GLOBAL_CANCEL),
    );

    expect(Object.keys(viewed).sort()).toEqual(PUBLIC_KEYS);
  });

  test("a lifted block keeps its reason for the bot's owner", async () => {
    const viewed = await settle(
      apiViewedBy(ROCK_BOT_OWNER).getTransaction(LIFTED_CANCEL),
    );

    expect(viewed.cause).toEqual({
      kind: "bot",
      bot: { name: "Rock bot", removed: false },
      state: "lifted",
      reason: "Spammed trades from a bot farm.",
    });
  });

  test("a Completed transaction has no cause", async () => {
    const viewed = await settle(
      createMockApi().getTransaction(COMPLETED_TRADE),
    );

    expect(viewed.userId).toBe(NEW_BLOCKED_ID);
    expect("cause" in viewed).toBe(false);
  });

  test("a block records itself as the cause, and lifting it shows lifted", async () => {
    const api = createMockApi();
    const blockList = api.botBlocks(OAT_BOT.id);
    await settle(
      blockList.block(NEW_BLOCKED_ID, "Laundered.", {
        window: "all",
        direction: "incoming",
      }),
    );

    const reversed = await settle(api.getTransaction(COMPLETED_TRADE));
    await settle(blockList.unblock(NEW_BLOCKED_ID));
    const afterLift = await settle(api.getTransaction(COMPLETED_TRADE));

    expect(reversed.status).toBe("Reversed");
    expect(reversed.cause).toEqual({
      kind: "bot",
      bot: HARVEST_BOT,
      state: "active",
      reason: "Laundered.",
    });
    expect(afterLift.cause).toEqual({
      kind: "bot",
      bot: HARVEST_BOT,
      state: "lifted",
      reason: "Laundered.",
    });
  });

  test("a trading admin reads the reason of a site wide block on their trade", async () => {
    const api = createMockApi();
    await settle(api.globalBlocks.block(OAT_BOT_OWNER, "Self test."));

    const viewed = await settle(api.getTransaction(OWN_PENDING_TRADE));

    expect(viewed.userId).toBe(OAT_BOT_OWNER);
    expect(viewed.cause).toEqual({
      kind: "global",
      state: "active",
      reason: "Self test.",
    });
  });

  test("a trading owner reads the reason of their own bot's block", async () => {
    const api = createMockApi();
    await settle(api.botBlocks(OAT_BOT.id).block(OAT_BOT_OWNER, "Self test."));

    const viewed = await settle(api.getTransaction(OWN_PENDING_TRADE));

    expect(viewed.cause).toEqual({
      kind: "bot",
      bot: HARVEST_BOT,
      state: "active",
      reason: "Self test.",
    });
  });

  test("a cancel without a block says so", async () => {
    const viewed = await settle(
      createMockApi().getTransaction("019a7a51-c7f2-7b08-9d5e-31a6f0c8e7b4"),
    );

    expect(viewed.cause).toEqual({ kind: "none" });
  });

  test("a removed blocking bot is marked removed and its reason is for nobody", async () => {
    const api = apiViewedBy(ADMIN_ONLY);
    await settle(api.removeBot(ROCK_BOT.id));

    const viewed = await settle(api.getTransaction(LIFTED_CANCEL));

    expect(viewed.cause).toEqual({
      kind: "bot",
      bot: { name: "Rock bot", removed: true },
      state: "lifted",
    });
  });
});
