import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DiscoinApi } from "../api/client.js";
import { createMockApi } from "./api.js";
import { sampleBots, sampleCurrentUser } from "./data.js";
import { apiErrorOf, settle } from "./settle.js";
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

describe("one transaction", () => {
  test("an unknown ID is a 404 and a malformed one a 400 on the ID field", async () => {
    const api = createMockApi();
    const unknown = await apiErrorOf(
      api.getTransaction("019a0000-0000-7000-8000-000000000000"),
    );
    const malformed = await apiErrorOf(api.getTransaction("nope"));

    expect([unknown.status, unknown.message]).toEqual([
      404,
      "No transaction with that ID.",
    ]);
    expect([malformed.status, malformed.field]).toEqual([
      400,
      "transaction_id",
    ]);
  });

  test.each([COMPLETED_TRADE.toUpperCase(), `urn:uuid:${COMPLETED_TRADE}`])(
    "accepts %s like the API does",
    async (id) => {
      const viewed = await settle(createMockApi().getTransaction(id));

      expect(viewed.id).toBe(COMPLETED_TRADE);
    },
  );

  test.each([
    { name: "a logged out viewer", open: loggedOutApi },
    { name: "an unrelated viewer", open: async () => apiViewedBy(STRANGER) },
  ])("$name gets only the public keys", async ({ open }) => {
    const viewed = await settle((await open()).getTransaction(OAT_BOT_CANCEL));
    const text = JSON.stringify(viewed);

    expect(Object.keys(viewed).sort()).toEqual(PUBLIC_KEYS);
    expect(text).not.toContain(OAT_BOT_TRADER);
    expect(text).not.toContain(OAT_BOT_REASON);
  });

  test.each([
    { viewerId: OAT_BOT_OWNER, reads: true },
    { viewerId: OAT_BOT_TRADER, reads: false },
    { viewerId: ROCK_BOT_OWNER, reads: false },
    { viewerId: ADMIN_ONLY, reads: false },
  ])(
    "a bot block reason is for its owner only: $viewerId reads it is $reads",
    async ({ viewerId, reads }) => {
      const viewed = await settle(
        apiViewedBy(viewerId).getTransaction(OAT_BOT_CANCEL),
      );

      expect(viewed.userId).toBe(OAT_BOT_TRADER);
      expect(viewed.cause).toEqual({
        kind: "bot",
        bot: HARVEST_BOT,
        state: "active",
        ...(reads ? { reason: OAT_BOT_REASON } : {}),
      });
    },
  );

  test.each([
    { viewerId: OAT_BOT_OWNER, reads: true },
    { viewerId: ADMIN_ONLY, reads: true },
    { viewerId: GLOBAL_TRADER, reads: false },
  ])(
    "a site wide reason is for owners and admins: $viewerId reads it is $reads",
    async ({ viewerId, reads }) => {
      const viewed = await settle(
        apiViewedBy(viewerId).getTransaction(GLOBAL_CANCEL),
      );

      expect(viewed.cause).toEqual({
        kind: "global",
        state: "active",
        ...(reads ? { reason: GLOBAL_REASON } : {}),
      });
    },
  );

  test("an owner of neither side who didn't trade gets the public keys", async () => {
    const viewed = await settle(
      apiViewedBy(ROCK_BOT_OWNER).getTransaction(GLOBAL_CANCEL),
    );

    expect(Object.keys(viewed).sort()).toEqual(PUBLIC_KEYS);
  });

  test("a Completed transaction has no cause", async () => {
    const viewed = await settle(
      createMockApi().getTransaction(COMPLETED_TRADE),
    );

    expect(viewed.userId).toBe(NEW_BLOCKED_ID);
    expect("cause" in viewed).toBe(false);
  });

  test("a cancel without a block says so", async () => {
    const viewed = await settle(
      createMockApi().getTransaction("019a7a51-c7f2-7b08-9d5e-31a6f0c8e7b4"),
    );

    expect(viewed.cause).toEqual({ kind: "none" });
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
