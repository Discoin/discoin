import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DiscoinApi } from "../api/client.js";
import { createMockApi } from "./api.js";
import { sampleCurrencies, sampleCurrentUser } from "./data.js";
import { apiErrorOf, settle } from "./settle.js";

const [OATS, PEBBLES] = sampleCurrencies;
const OWNER_ID = "305918264730192845";
const BLOCKED_ID = "700000000000000001";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("currency details", () => {
  test("an abbreviation used by another currency is refused on its field", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.updateCurrencyDetails(OATS.id, {
        name: "Oats",
        abbreviation: PEBBLES.abbreviation.toLowerCase(),
      }),
    );

    expect(error.status).toBe(409);
    expect(error.field).toBe("abbreviation");
  });

  test("a currency the user doesn't own can't be changed", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.updateCurrencyDetails(PEBBLES.id, {
        name: "Rocks",
        abbreviation: "RCK",
      }),
    );

    expect(error.status).toBe(403);
  });
});

describe("adding a currency", () => {
  test("starts the reserve at 4 times the median and records the owner", async () => {
    const api = createMockApi();
    const added = await settle(
      api.addCurrency({
        name: "Shells",
        abbreviation: "shl",
        weeklyMedian: 50_000,
        ownerId: OWNER_ID,
      }),
    );

    expect(added.currency.abbreviation).toBe("SHL");
    expect(added.currency.reserve).toBe(200_000);
    expect(added.ownerId).toBe(OWNER_ID);
  });

  test("an owner ID that isn't a Discord user ID is refused on its field", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.addCurrency({
        name: "Shells",
        abbreviation: "SHL",
        weeklyMedian: 50_000,
        ownerId: "shell-bot",
      }),
    );

    expect(error.field).toBe("ownerId");
  });

  test("a currency added for the current user shows up as theirs", async () => {
    const api = createMockApi();
    await settle(
      api.addCurrency({
        name: "Shells",
        abbreviation: "SHL",
        weeklyMedian: 50_000,
        ownerId: sampleCurrentUser.userId,
      }),
    );
    const owned = await settle(api.listOwnedCurrencies());

    expect(owned.map((currency) => currency.abbreviation)).toContain("SHL");
  });
});

describe("owner settings", () => {
  test("a webhook must be an https URL", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.setWebhookUrl(OATS.id, "http://bot.example.com"),
    );

    expect(error.field).toBe("webhookUrl");
  });

  test("a daily cap must be above 0", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.setDailyCap(OATS.id, Number.NaN));

    expect(error.field).toBe("dailyCap");
  });
});

describe("admins", () => {
  test("an admin can't remove their own access", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.removeAdmin(sampleCurrentUser.userId));

    expect(error.status).toBe(400);
  });
});

describe("blocking", () => {
  const blockLists = [
    { name: "global", open: (api: DiscoinApi) => api.globalBlocks },
    {
      name: "currency",
      open: (api: DiscoinApi) => api.currencyBlocks(OATS.id),
    },
  ];
  for (const { name, open } of blockLists) {
    for (const reason of ["", "   "]) {
      test(`a ${name} block with the reason "${reason}" is refused on its field`, async () => {
        const blockList = open(createMockApi());
        const before = await settle(blockList.list());
        const error = await apiErrorOf(blockList.block(BLOCKED_ID, reason));
        const after = await settle(blockList.list());

        expect(error.status).toBe(400);
        expect(error.field).toBe("reason");
        expect(after).toEqual(before);
      });
    }

    test(`a ${name} block stores its trimmed reason`, async () => {
      const blockList = open(createMockApi());
      await settle(blockList.block(BLOCKED_ID, "  Spammed trades.  "));
      const listed = await settle(blockList.list());

      expect(listed.find((user) => user.userId === BLOCKED_ID)?.reason).toBe(
        "Spammed trades.",
      );
    });

    test(`blocking the same user twice on the ${name} list is refused`, async () => {
      const blockList = open(createMockApi());
      const [blocked] = await settle(blockList.list());
      const error = await apiErrorOf(blockList.block(blocked.userId, "Again."));

      expect(error.status).toBe(409);
      expect(error.field).toBe("userId");
    });
  }

  test("an owner's list includes every global ban, marked global", async () => {
    const api = createMockApi();
    const globalBans = await settle(api.globalBlocks.list());
    const ownerView = await settle(api.currencyBlocks(OATS.id).list());

    expect(ownerView).toEqual(expect.arrayContaining(globalBans));
    expect(globalBans.every((user) => user.level === "global")).toBe(true);
    expect(api.currencyBlocks(OATS.id).level).toBe("currency");
  });

  test("an owner can't unblock a global ban", async () => {
    const api = createMockApi();
    const globalBans = await settle(api.globalBlocks.list());
    const error = await apiErrorOf(
      api.currencyBlocks(OATS.id).unblock(globalBans[0].userId),
    );

    expect(error.status).toBe(404);
    expect(await settle(api.globalBlocks.list())).toEqual(globalBans);
  });
});

describe("currency page", () => {
  test("finds a currency by abbreviation in any case", async () => {
    const api = createMockApi();
    const found = await settle(api.getCurrency("oat"));

    expect(found.id).toBe(OATS.id);
  });

  test("an unknown abbreviation is a 404", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.getCurrency("NOPE"));

    expect(error.status).toBe(404);
  });

  test("lists only trades into or out of the currency", async () => {
    const api = createMockApi();
    const trades = await settle(api.listCurrencyTransactions(OATS.id));

    expect(trades.length).toBeGreaterThan(0);
    for (const trade of trades) {
      expect([trade.fromCurrencyId, trade.toCurrencyId]).toContain(OATS.id);
    }
  });
});

describe("updating a currency", () => {
  test("an owner change moves the currency to the new owner's list", async () => {
    const api = createMockApi();
    const updated = await settle(
      api.updateCurrency(OATS.id, { ownerId: OWNER_ID }),
    );
    const owned = await settle(api.listOwnedCurrencies());

    expect(updated.ownerId).toBe(OWNER_ID);
    expect(updated.currency.reserve).toBe(OATS.reserve);
    expect(owned.map((currency) => currency.id)).not.toContain(OATS.id);
  });

  test("saves an owner and a median together", async () => {
    const api = createMockApi();
    const updated = await settle(
      api.updateCurrency(OATS.id, { ownerId: OWNER_ID, weeklyMedian: 300_000 }),
    );

    expect(updated.ownerId).toBe(OWNER_ID);
    expect(updated.weeklyMedian).toBe(300_000);
    expect(updated.currency.reserve).toBe(1_200_000);
  });

  test("a bad owner ID saves nothing, even with a valid median", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.updateCurrency(OATS.id, { ownerId: "12ab", weeklyMedian: 300_000 }),
    );
    const [oats] = await settle(api.listAdminCurrencies());

    expect(error.field).toBe("ownerId");
    expect(oats.weeklyMedian).not.toBe(300_000);
    expect(oats.currency.reserve).toBe(OATS.reserve);
  });

  test("an unknown currency is a 404", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.updateCurrency("no-such-id", { ownerId: OWNER_ID }),
    );

    expect(error.status).toBe(404);
  });

  test("saving with no changes is refused", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.updateCurrency(OATS.id, {}));

    expect(error.status).toBe(400);
  });
});

describe("api contract", () => {
  const TICKETS = sampleCurrencies[4];
  const PENDING_INTO_OATS = "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4";

  for (const abbreviation of ["OA", "OATSS", "OA1", "O T"]) {
    test(`the abbreviation "${abbreviation}" is refused like the API does`, async () => {
      const api = createMockApi();
      const error = await apiErrorOf(
        api.updateCurrencyDetails(OATS.id, { name: "Oats", abbreviation }),
      );

      expect(error.message).toBe(
        "Use 3 or 4 letters, A to Z, for the abbreviation.",
      );
      expect(error.field).toBe("abbreviation");
    });
  }

  test("settings say whether a token and secret exist, never the token", async () => {
    const api = createMockApi();
    const settings = await settle(api.getCurrencySettings(TICKETS.id));

    expect(settings).toEqual({
      hasApiToken: false,
      hasWebhookSecret: false,
      webhookUrl: null,
      dailyCap: null,
    });
  });

  test("a webhook URL needs a secret first", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.setWebhookUrl(TICKETS.id, "https://bot.example.com/hook"),
    );
    await settle(api.generateWebhookSecret(TICKETS.id));
    await settle(api.setWebhookUrl(TICKETS.id, "https://bot.example.com/hook"));
    const settings = await settle(api.getCurrencySettings(TICKETS.id));

    expect(error.field).toBe("webhookUrl");
    expect(settings.hasWebhookSecret).toBe(true);
    expect(settings.webhookUrl).toBe("https://bot.example.com/hook");
  });

  test("a block cancels the user's Pending transactions with the currency", async () => {
    const api = createMockApi();
    await settle(
      api
        .currencyBlocks(OATS.id)
        .block(sampleCurrentUser.userId, "Testing the block"),
    );
    const mine = await settle(api.listMyTransactions());
    const cancelled = mine.find(
      (transaction) => transaction.id === PENDING_INTO_OATS,
    );

    expect(cancelled?.status).toBe("Cancelled");
    expect(cancelled?.handledAt).not.toBeNull();
  });

  test("pending transactions carry the sender", async () => {
    const api = createMockApi();
    const pending = await settle(api.listPendingTransactions(OATS.id));

    expect(pending.every((transaction) => transaction.userId !== "")).toBe(
      true,
    );
  });

  test("logging out leaves no current user", async () => {
    const api = createMockApi();
    const before = await settle(api.getMe());
    await settle(api.logout());

    expect(before?.isAdmin).toBe(true);
    expect(await settle(api.getMe())).toBeNull();
  });

  test("a deactivated currency leaves the public list and cancels its Pending transactions", async () => {
    const api = createMockApi();
    const updated = await settle(
      api.updateCurrency(OATS.id, { active: false }),
    );
    const listed = await settle(api.listCurrencies());
    const mine = await settle(api.listMyTransactions());

    expect(updated.currency.active).toBe(false);
    expect(listed.map((currency) => currency.id)).not.toContain(OATS.id);
    expect(
      mine.find((transaction) => transaction.id === PENDING_INTO_OATS)?.status,
    ).toBe("Cancelled");
  });

  test("the quote refuses an inactive currency on its field", async () => {
    const api = createMockApi();
    await settle(api.updateCurrency(OATS.id, { active: false }));
    const error = await apiErrorOf(api.getQuote(PEBBLES.id, OATS.id, 10));

    expect(error.field).toBe("toCurrencyId");
  });

  test("history keeps only the asked window", async () => {
    const api = createMockApi();
    const week = await settle(api.getReserveHistory(OATS.id, 7));
    const month = await settle(api.getReserveHistory(OATS.id, 30));

    expect(week.length).toBe(8);
    expect(month.length).toBe(31);
  });
});
