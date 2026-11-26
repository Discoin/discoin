import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DiscoinApi } from "../api/client.js";
import { createMockApi } from "./api.js";
import { sampleBots, sampleCurrencies, sampleCurrentUser } from "./data.js";
import { apiErrorOf, settle } from "./settle.js";

const [OATS, PEBBLES, SCRAP, GEMS, TICKETS] = sampleCurrencies;
const [OAT_BOT, ROCK_BOT, , TICKET_BOT] = sampleBots;
const OAT_BOT_ID = OAT_BOT.id;
const ROCK_BOT_ID = ROCK_BOT.id;
const TICKET_BOT_ID = TICKET_BOT.id;
const BLOCKED_ID = "700000000000000001";
const GEMS_BLOCKED_ID = "481920374650192837";
const PENDING_INTO_OATS = "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4";
const NEW_BOT = {
  name: "Shell bot",
  discordId: "990000000000000009",
  ownerId: "305918264730192845",
};
const SHELLS = {
  name: "Shells",
  abbreviation: "SHL",
  weeklyMedian: 50_000,
  multiplier: 10,
  botId: ROCK_BOT_ID,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ownership", () => {
  test.each([
    {
      name: "currency details",
      call: (api: DiscoinApi) =>
        api.updateCurrencyDetails(PEBBLES.id, {
          name: "Rocks",
          abbreviation: "RCK",
        }),
    },
    {
      name: "API token",
      call: (api: DiscoinApi) => api.regenerateApiToken(ROCK_BOT_ID),
    },
    {
      name: "bot settings",
      call: (api: DiscoinApi) => api.getBotSettings(ROCK_BOT_ID),
    },
    {
      name: "pending list",
      call: (api: DiscoinApi) => api.listPendingTransactions(ROCK_BOT_ID),
    },
  ])("another owner's $name is refused with a 403", async ({ call }) => {
    const error = await apiErrorOf(call(createMockApi()));

    expect(error.status).toBe(403);
  });

  test("a botless currency has no owner", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.getCurrencySettings(GEMS.id));

    expect(error.status).toBe(403);
    expect(error.message).toMatch(/no bot yet/);
  });
});

describe("owner settings", () => {
  test.each([
    {
      field: "abbreviation",
      call: (api: DiscoinApi) =>
        api.updateCurrencyDetails(OATS.id, {
          name: "Oats",
          abbreviation: PEBBLES.abbreviation.toLowerCase(),
        }),
      status: 409,
    },
    {
      field: "abbreviation",
      call: (api: DiscoinApi) =>
        api.updateCurrencyDetails(OATS.id, {
          name: "Oats",
          abbreviation: "O T",
        }),
      status: 400,
    },
    {
      field: "webhookUrl",
      call: (api: DiscoinApi) =>
        api.setWebhookUrl(OAT_BOT_ID, "http://bot.example.com"),
      status: 400,
    },
    {
      field: "dailyCap",
      call: (api: DiscoinApi) => api.setDailyCap(OATS.id, Number.NaN),
      status: 400,
    },
  ])(
    "a bad $field is refused with a $status on its field",
    async ({ call, field, status }) => {
      const error = await apiErrorOf(call(createMockApi()));

      expect([error.status, error.field]).toEqual([status, field]);
    },
  );

  test("a new bot has no token or secret, and a webhook URL needs a secret first", async () => {
    const api = createMockApi();
    const before = await settle(api.getBotSettings(TICKET_BOT_ID));
    const error = await apiErrorOf(
      api.setWebhookUrl(TICKET_BOT_ID, "https://bot.example.com/hook"),
    );
    await settle(api.generateWebhookSecret(TICKET_BOT_ID));
    await settle(api.regenerateApiToken(TICKET_BOT_ID));
    await settle(
      api.setWebhookUrl(TICKET_BOT_ID, "https://bot.example.com/hook"),
    );
    const after = await settle(api.getBotSettings(TICKET_BOT_ID));

    expect(before).toEqual({
      hasApiToken: false,
      hasWebhookSecret: false,
      webhookUrl: null,
    });
    expect(error.field).toBe("webhookUrl");
    expect(after).toEqual({
      hasApiToken: true,
      hasWebhookSecret: true,
      webhookUrl: "https://bot.example.com/hook",
    });
    expect(await settle(api.getCurrencySettings(OATS.id))).toEqual({
      dailyCap: 5_000,
    });
  });

  test("owner writes on an inactive currency are refused on the currency", async () => {
    const api = createMockApi();
    await settle(api.updateCurrency(OATS.id, { active: false }));

    const refusals = [
      await apiErrorOf(
        api.updateCurrencyDetails(OATS.id, {
          name: "Oaty",
          abbreviation: "OAT",
        }),
      ),
      await apiErrorOf(api.setDailyCap(OATS.id, 10)),
      await apiErrorOf(api.removeDailyCap(OATS.id)),
    ];
    const settings = await settle(api.getCurrencySettings(OATS.id));

    for (const refusal of refusals) {
      expect([refusal.status, refusal.message, refusal.field]).toEqual([
        400,
        "OAT is inactive, so its settings can't be changed until a Discoin admin reactivates it.",
        "currencyId",
      ]);
    }

    expect(settings).toEqual({ dailyCap: 5_000 });
  });

  test("the owner's bots come in name order with currencies in abbreviation order", async () => {
    const api = createMockApi();
    await settle(api.updateCurrency(GEMS.id, { botId: OAT_BOT_ID }));
    const bots = await settle(api.listOwnedBots());
    const me = await settle(api.getMe());

    expect(
      bots.map((bot) => [
        bot.name,
        bot.currencies.map((currency) => currency.abbreviation),
      ]),
    ).toEqual([
      ["Harvest bot", ["GEM", "OAT", "SCR"]],
      ["Ticket bot", ["TKT"]],
    ]);
    expect(me?.ownedBots).toEqual([
      {
        id: OAT_BOT_ID,
        name: "Harvest bot",
        currencyIds: [GEMS.id, OATS.id, SCRAP.id],
      },
      { id: TICKET_BOT_ID, name: "Ticket bot", currencyIds: [TICKETS.id] },
    ]);
  });

  test("the pending list is the bot's, each row naming its currency and sender", async () => {
    const api = createMockApi();
    const pending = await settle(api.listPendingTransactions(TICKET_BOT_ID));

    expect(
      pending.map((transaction) => transaction.toCurrency.abbreviation),
    ).toEqual([TICKETS.abbreviation]);
    expect(pending.every((transaction) => transaction.userId !== "")).toBe(
      true,
    );
  });
});

describe("blocking", () => {
  const blockLists = [
    { name: "global", open: (api: DiscoinApi) => api.globalBlocks },
    { name: "bot", open: (api: DiscoinApi) => api.botBlocks(OAT_BOT_ID) },
  ];

  for (const { name, open } of blockLists) {
    test(`a ${name} block needs a reason and stores it trimmed`, async () => {
      const blockList = open(createMockApi());
      const before = await settle(blockList.list());
      const error = await apiErrorOf(blockList.block(BLOCKED_ID, "   "));
      const unchanged = await settle(blockList.list());
      await settle(blockList.block(BLOCKED_ID, "  Spammed trades.  "));
      const listed = await settle(blockList.list());

      expect([error.status, error.field]).toEqual([400, "reason"]);
      expect(unchanged).toEqual(before);
      expect(listed.find((user) => user.userId === BLOCKED_ID)?.reason).toBe(
        "Spammed trades.",
      );
    });

    test(`blocking the same user twice on the ${name} list is refused`, async () => {
      const blockList = open(createMockApi());
      const [blocked] = await settle(blockList.list());
      const error = await apiErrorOf(blockList.block(blocked.userId, "Again."));

      expect([error.status, error.field]).toEqual([409, "userId"]);
    });
  }

  test("an owner sees every global ban, marked global, and can't lift one", async () => {
    const api = createMockApi();
    const globalBans = await settle(api.globalBlocks.list());
    const ownerView = await settle(api.botBlocks(OAT_BOT_ID).list());
    const error = await apiErrorOf(
      api.botBlocks(OAT_BOT_ID).unblock(globalBans[0].userId),
    );

    expect(ownerView).toEqual(expect.arrayContaining(globalBans));
    expect(globalBans.every((user) => user.level === "global")).toBe(true);
    expect(error.status).toBe(404);
    expect(await settle(api.globalBlocks.list())).toEqual(globalBans);
  });

  test("a block cancels the user's Pending transactions with the bot's currencies", async () => {
    const api = createMockApi();
    await settle(
      api
        .botBlocks(OAT_BOT_ID)
        .block(sampleCurrentUser.userId, "Testing the block"),
    );
    const mine = await settle(api.listMyTransactions());
    const cancelled = mine.find(
      (transaction) => transaction.id === PENDING_INTO_OATS,
    );

    expect(cancelled?.status).toBe("Cancelled");
    expect(cancelled?.handledAt).not.toBeNull();
  });
});

describe("public reads", () => {
  test("a currency is found by abbreviation in any case, an unknown one is a 404", async () => {
    const api = createMockApi();
    const found = await settle(api.getCurrency("oat"));
    const error = await apiErrorOf(api.getCurrency("NOPE"));

    expect(found.id).toBe(OATS.id);
    expect(error.status).toBe(404);
  });

  test("an inactive currency is a 404 by abbreviation, history and trades", async () => {
    const api = createMockApi();
    await settle(api.updateCurrency(OATS.id, { active: false }));

    const lookup = await apiErrorOf(api.getCurrency("OAT"));
    const history = await apiErrorOf(api.getReserveHistory(OATS.id, 7));
    const trades = await apiErrorOf(api.listCurrencyTransactions(OATS.id));

    expect([lookup.status, history.status, trades.status]).toEqual([
      404, 404, 404,
    ]);
  });

  test("a currency's trades all go into or out of it", async () => {
    const api = createMockApi();
    const trades = await settle(api.listCurrencyTransactions(OATS.id));

    expect(trades.length).toBeGreaterThan(0);
    for (const trade of trades) {
      expect([trade.fromCurrencyId, trade.toCurrencyId]).toContain(OATS.id);
    }
  });

  test("history keeps only the asked window", async () => {
    const api = createMockApi();
    const week = await settle(api.getReserveHistory(OATS.id, 7));
    const month = await settle(api.getReserveHistory(OATS.id, 30));

    expect(week.length).toBe(8);
    expect(month.length).toBe(31);
  });

  test("logging out leaves no current user", async () => {
    const api = createMockApi();
    const before = await settle(api.getMe());
    await settle(api.logout());

    expect(before?.isAdmin).toBe(true);
    expect(await settle(api.getMe())).toBeNull();
  });
});

describe("admin currency edits", () => {
  test("adding a currency starts the reserve at the median times its multiplier", async () => {
    const api = createMockApi();
    const added = await settle(
      api.addCurrency({ ...SHELLS, abbreviation: "shl" }),
    );

    expect(added.currency.abbreviation).toBe("SHL");
    expect(added.currency.reserve).toBe(500_000);
    expect(added.multiplier).toBe(10);
    expect(added.bot).toEqual({ id: ROCK_BOT_ID, name: "Rock bot" });
  });

  test.each([
    { bad: { botId: null }, status: 400, field: "botId" },
    { bad: { botId: "no-such-bot" }, status: 404, field: "botId" },
    { bad: { multiplier: 0 }, status: 400, field: "multiplier" },
    { bad: { multiplier: 1.234 }, status: 400, field: "multiplier" },
  ])(
    "adding with $bad is refused on its field and adds nothing",
    async ({ bad, status, field }) => {
      const api = createMockApi();
      const error = await apiErrorOf(api.addCurrency({ ...SHELLS, ...bad }));
      const listed = await settle(api.listAdminCurrencies());

      expect([error.status, error.field]).toEqual([status, field]);
      expect(listed.map((entry) => entry.currency.abbreviation)).not.toContain(
        "SHL",
      );
    },
  );

  test("a botless currency gets its bot once and its blocks move to the bot", async () => {
    const api = createMockApi();
    const { saved, movedBlocks } = await settle(
      api.updateCurrency(GEMS.id, { botId: OAT_BOT_ID }),
    );
    const oatBlocks = await settle(api.botBlocks(OAT_BOT_ID).list());
    const again = await apiErrorOf(
      api.updateCurrency(GEMS.id, { botId: ROCK_BOT_ID }),
    );

    expect(saved.bot).toEqual({ id: OAT_BOT_ID, name: "Harvest bot" });
    expect(movedBlocks).toBe(1);
    expect(oatBlocks.map((user) => user.userId)).toContain(GEMS_BLOCKED_ID);
    expect([again.status, again.field]).toEqual([409, "botId"]);
  });

  test("a bot and a median save together", async () => {
    const api = createMockApi();
    const { saved } = await settle(
      api.updateCurrency(GEMS.id, { botId: ROCK_BOT_ID, weeklyMedian: 30_000 }),
    );

    expect(saved.bot?.id).toBe(ROCK_BOT_ID);
    expect(saved.weeklyMedian).toBe(30_000);
    expect(saved.currency.reserve).toBe(120_000);
  });

  test("a new median and multiplier reset the reserve once", async () => {
    const api = createMockApi();
    const { saved } = await settle(
      api.updateCurrency(OATS.id, { weeklyMedian: 30_000, multiplier: 5 }),
    );
    const history = await settle(api.getReserveHistory(OATS.id, 30));

    expect(saved.currency.reserve).toBe(150_000);
    expect(history.slice(-2).map((point) => point.reserve)).toEqual([
      OATS.reserve,
      150_000,
    ]);
  });

  test.each([
    {
      name: "a cleared multiplier",
      currencyId: OATS.id,
      changes: { weeklyMedian: 50_000, multiplier: Number.NaN },
      status: 400,
      field: "multiplier",
    },
    {
      name: "a bad multiplier with a status change",
      currencyId: OATS.id,
      changes: { active: false, multiplier: 0.001 },
      status: 400,
      field: "multiplier",
    },
    {
      name: "an unknown bot with a valid median",
      currencyId: GEMS.id,
      changes: { botId: "no-such-bot", weeklyMedian: 1 },
      status: 404,
      field: "botId",
    },
  ])("$name saves nothing", async ({ currencyId, changes, status, field }) => {
    const api = createMockApi();
    const before = await settle(api.listAdminCurrencies());
    const error = await apiErrorOf(api.updateCurrency(currencyId, changes));
    const after = await settle(api.listAdminCurrencies());

    expect([error.status, error.field]).toEqual([status, field]);
    expect(after).toEqual(before);
  });

  test("an unknown currency is a 404 and an empty change is refused", async () => {
    const api = createMockApi();
    const unknown = await apiErrorOf(
      api.updateCurrency("no-such-id", { weeklyMedian: 10 }),
    );
    const empty = await apiErrorOf(api.updateCurrency(OATS.id, {}));

    expect([unknown.status, empty.status]).toEqual([404, 400]);
  });

  test("a deactivated currency leaves the public list, cancels its Pending transactions and refuses quotes", async () => {
    const api = createMockApi();
    const { saved } = await settle(
      api.updateCurrency(OATS.id, { active: false }),
    );
    const listed = await settle(api.listCurrencies());
    const mine = await settle(api.listMyTransactions());
    const quote = await apiErrorOf(api.getQuote(PEBBLES.id, OATS.id, 10));

    expect(saved.currency.active).toBe(false);
    expect(listed.map((currency) => currency.id)).not.toContain(OATS.id);
    expect(
      mine.find((transaction) => transaction.id === PENDING_INTO_OATS)?.status,
    ).toBe("Cancelled");
    expect(quote.field).toBe("toCurrencyId");
  });

  test("an admin can't remove their own access", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.removeAdmin(sampleCurrentUser.userId));

    expect(error.status).toBe(400);
  });
});

describe("bots", () => {
  test("an admin registers a bot with no currencies", async () => {
    const api = createMockApi();
    const added = await settle(api.addBot(NEW_BOT));
    const listed = await settle(api.listAdminBots());

    expect(added.currencyCount).toBe(0);
    expect(listed.map((bot) => bot.id)).toContain(added.id);
  });

  test.each([
    { name: " ", field: "name" },
    { discordId: "42", field: "discordId" },
    { ownerId: "owner", field: "ownerId" },
  ])("refuses a bad $field on its field", async ({ field, ...bad }) => {
    const api = createMockApi();
    const error = await apiErrorOf(api.addBot({ ...NEW_BOT, ...bad }));

    expect(error.field).toBe(field);
  });

  test("a live bot's Discord ID is taken", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.addBot({ ...NEW_BOT, discordId: OAT_BOT.discordId }),
    );

    expect([error.status, error.field]).toEqual([409, "discordId"]);
  });

  test("a new owner clears the token and webhook and keeps the blocks", async () => {
    const api = createMockApi();
    const changed = await settle(
      api.updateBot(OAT_BOT_ID, { ownerId: NEW_BOT.ownerId }),
    );
    const blocked = await settle(api.previewBotRemoval(OAT_BOT_ID));
    await settle(api.updateBot(OAT_BOT_ID, { ownerId: OAT_BOT.ownerId }));
    const settings = await settle(api.getBotSettings(OAT_BOT_ID));

    expect(changed.ownerId).toBe(NEW_BOT.ownerId);
    expect(blocked.enforcedBlocks).toBe(1);
    expect(settings).toMatchObject({
      hasApiToken: false,
      hasWebhookSecret: false,
      webhookUrl: null,
    });
  });
});

describe("removal", () => {
  test("the preview counts the currencies, Pending transactions and blocks", async () => {
    const api = createMockApi();
    const bot = await settle(api.previewBotRemoval(OAT_BOT_ID));
    const currency = await settle(api.previewCurrencyRemoval(GEMS.id));

    expect(bot).toEqual({
      currencies: [
        { id: OATS.id, abbreviation: "OAT", name: "Oats" },
        { id: SCRAP.id, abbreviation: "SCR", name: "Scrap" },
      ],
      pendingTransactions: 2,
      enforcedBlocks: 1,
    });
    expect(currency.enforcedBlocks).toBe(1);
  });

  test("leak 13: a removed currency leaves every mock list and lookup and cancels its Pending transactions", async () => {
    const api = createMockApi();
    await settle(api.removeCurrency(OATS.id));

    const listed = await settle(api.listCurrencies());
    const admin = await settle(api.listAdminCurrencies());
    const owned = (await settle(api.listOwnedBots())).flatMap(
      (bot) => bot.currencies,
    );
    const mine = await settle(api.listMyTransactions());
    const lookup = await apiErrorOf(api.getCurrency("OAT"));
    const history = await apiErrorOf(api.getReserveHistory(OATS.id, 7));
    const trades = await apiErrorOf(api.listCurrencyTransactions(OATS.id));
    const quote = await apiErrorOf(api.getQuote(PEBBLES.id, OATS.id, 10));
    const edit = await apiErrorOf(
      api.updateCurrency(OATS.id, { active: true }),
    );

    expect(listed.map((found) => found.id)).not.toContain(OATS.id);
    expect(admin.map((entry) => entry.currency.id)).not.toContain(OATS.id);
    expect(owned.map((found) => found.id)).not.toContain(OATS.id);
    expect(
      mine.find((transaction) => transaction.toCurrencyId === OATS.id)?.status,
    ).toBe("Cancelled");
    expect(
      [lookup, history, trades, quote, edit].map((error) => error.status),
    ).toEqual([404, 404, 404, 404, 404]);
  });

  test("a removed abbreviation can be used again and history tells them apart", async () => {
    const api = createMockApi();
    await settle(api.removeCurrency(OATS.id));
    const added = await settle(
      api.addCurrency({
        name: "New oats",
        abbreviation: "OAT",
        weeklyMedian: 1_000,
        multiplier: 4,
        botId: ROCK_BOT_ID,
      }),
    );
    const recent = await settle(api.listRecentTransactions());
    const found = await settle(api.getCurrency("oat"));

    expect(found.id).toBe(added.currency.id);
    expect(
      recent.find((transaction) => transaction.toCurrencyId === OATS.id)
        ?.toCurrency,
    ).toEqual({ abbreviation: "OAT", name: "Oats", removed: true });
  });

  test("removing a bot removes its currencies, leaves the bot list and frees its Discord ID", async () => {
    const api = createMockApi();
    await settle(api.removeBot(ROCK_BOT_ID));
    const bots = await settle(api.listAdminBots());
    const listed = await settle(api.listCurrencies());
    const again = await apiErrorOf(api.removeBot(ROCK_BOT_ID));
    const added = await settle(
      api.addBot({ ...NEW_BOT, discordId: ROCK_BOT.discordId }),
    );

    expect(bots.map((bot) => bot.id)).not.toContain(ROCK_BOT_ID);
    expect(listed.map((found) => found.id)).not.toContain(PEBBLES.id);
    expect(again.status).toBe(404);
    expect(added.discordId).toBe(ROCK_BOT.discordId);
  });
});
