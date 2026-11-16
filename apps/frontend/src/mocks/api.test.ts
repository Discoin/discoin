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
const NEW_BOT = {
  name: "Shell bot",
  discordId: "990000000000000009",
  ownerId: "305918264730192845",
};

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
  const SHELLS = {
    name: "Shells",
    abbreviation: "SHL",
    weeklyMedian: 50_000,
    multiplier: 10,
    botId: ROCK_BOT_ID,
  };

  test("starts the reserve at the median times its multiplier and records the bot", async () => {
    const api = createMockApi();
    const added = await settle(
      api.addCurrency({ ...SHELLS, abbreviation: "shl" }),
    );

    expect(added.currency.abbreviation).toBe("SHL");
    expect(added.currency.reserve).toBe(500_000);
    expect(added.multiplier).toBe(10);
    expect(added.bot).toEqual({ id: ROCK_BOT_ID, name: "Rock bot" });
  });

  test("a new currency needs a bot, refused on its field", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.addCurrency({ ...SHELLS, botId: null }));

    expect(error.status).toBe(400);
    expect(error.field).toBe("botId");
  });

  test("an unknown bot is refused on its field", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.addCurrency({ ...SHELLS, botId: "no-such-bot" }),
    );

    expect(error.status).toBe(404);
    expect(error.field).toBe("botId");
  });

  test.each([
    { multiplier: 0 },
    { multiplier: -4 },
    { multiplier: 1.234 },
    { multiplier: 10_000_000_000 },
    { weeklyMedian: 0.01, multiplier: 0.01 },
  ])("refuses %o on the multiplier field and adds nothing", async (bad) => {
    const api = createMockApi();
    const error = await apiErrorOf(api.addCurrency({ ...SHELLS, ...bad }));
    const listed = await settle(api.listAdminCurrencies());

    expect(error.status).toBe(400);
    expect(error.field).toBe("multiplier");
    expect(listed.map((entry) => entry.currency.abbreviation)).not.toContain(
      "SHL",
    );
  });

  test("a currency added to the current user's bot shows up as theirs", async () => {
    const api = createMockApi();
    await settle(api.addCurrency({ ...SHELLS, botId: OAT_BOT_ID }));
    const [harvest] = await settle(api.listOwnedBots());

    expect(harvest.currencies.map((currency) => currency.abbreviation)).toEqual(
      ["OAT", "SCR", "SHL"],
    );
  });
});

describe("owner settings", () => {
  test("a webhook must be an https URL", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.setWebhookUrl(OAT_BOT_ID, "http://bot.example.com"),
    );

    expect(error.field).toBe("webhookUrl");
  });

  test("a daily cap must be above 0", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.setDailyCap(OATS.id, Number.NaN));

    expect(error.field).toBe("dailyCap");
  });

  test("a bot the user doesn't own can't get a token", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.regenerateApiToken(ROCK_BOT_ID));

    expect(error.status).toBe(403);
    expect(error.message).toBe("You don't own that bot.");
  });

  test("bot settings belong to the bot and currency settings hold only the daily cap", async () => {
    const api = createMockApi();
    await settle(api.regenerateApiToken(TICKET_BOT_ID));

    const bot = await settle(api.getBotSettings(TICKET_BOT_ID));
    const currency = await settle(api.getCurrencySettings(OATS.id));

    expect(bot.hasApiToken).toBe(true);
    expect(currency).toEqual({ dailyCap: 5_000 });
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

  test("another owner's bot has no settings for this user", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.getBotSettings(ROCK_BOT_ID));

    expect(error.status).toBe(403);
  });

  test("the owner's bots come in name order with currencies in abbreviation order", async () => {
    const api = createMockApi();
    await settle(api.updateCurrency(GEMS.id, { botId: OAT_BOT_ID }));
    const bots = await settle(api.listOwnedBots());

    expect(
      bots.map((bot) => [
        bot.name,
        bot.currencies.map((currency) => currency.abbreviation),
      ]),
    ).toEqual([
      ["Harvest bot", ["GEM", "OAT", "SCR"]],
      ["Ticket bot", ["TKT"]],
    ]);
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
      name: "bot",
      open: (api: DiscoinApi) => api.botBlocks(OAT_BOT_ID),
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
    const ownerView = await settle(api.botBlocks(OAT_BOT_ID).list());

    expect(ownerView).toEqual(expect.arrayContaining(globalBans));
    expect(globalBans.every((user) => user.level === "global")).toBe(true);
    expect(api.botBlocks(OAT_BOT_ID).level).toBe("bot");
  });

  test("an owner can't unblock a global ban", async () => {
    const api = createMockApi();
    const globalBans = await settle(api.globalBlocks.list());
    const error = await apiErrorOf(
      api.botBlocks(OAT_BOT_ID).unblock(globalBans[0].userId),
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
  test("a botless currency gets its bot once and its blocks move to the bot", async () => {
    const api = createMockApi();
    const { saved, movedBlocks } = await settle(
      api.updateCurrency(GEMS.id, { botId: OAT_BOT_ID }),
    );
    const [harvest] = await settle(api.listOwnedBots());
    const oatBlocks = await settle(api.botBlocks(OAT_BOT_ID).list());

    expect(saved.bot).toEqual({ id: OAT_BOT_ID, name: "Harvest bot" });
    expect(movedBlocks).toBe(1);
    expect(harvest.currencies.map((currency) => currency.id)).toContain(
      GEMS.id,
    );
    expect(oatBlocks.map((user) => user.userId)).toContain(GEMS_BLOCKED_ID);
  });

  test.each([OAT_BOT_ID, ROCK_BOT_ID])(
    "a currency with a bot can't get the bot %s",
    async (botId) => {
      const api = createMockApi();
      const error = await apiErrorOf(api.updateCurrency(OATS.id, { botId }));
      const [oats] = await settle(api.listAdminCurrencies());

      expect(error.status).toBe(409);
      expect(error.field).toBe("botId");
      expect(oats.bot?.id).toBe(OAT_BOT_ID);
    },
  );

  test("saves a bot and a median together", async () => {
    const api = createMockApi();
    const { saved } = await settle(
      api.updateCurrency(GEMS.id, { botId: ROCK_BOT_ID, weeklyMedian: 30_000 }),
    );

    expect(saved.bot?.id).toBe(ROCK_BOT_ID);
    expect(saved.weeklyMedian).toBe(30_000);
    expect(saved.currency.reserve).toBe(120_000);
  });

  test("seeded currencies use a multiplier of 4", async () => {
    const api = createMockApi();
    const listed = await settle(api.listAdminCurrencies());

    expect(listed.every((entry) => entry.multiplier === 4)).toBe(true);
  });

  test("a new multiplier alone resets the reserve from the stored median", async () => {
    const api = createMockApi();
    const { saved } = await settle(
      api.updateCurrency(OATS.id, { multiplier: 10 }),
    );
    const history = await settle(api.getReserveHistory(OATS.id, 30));

    expect(saved.multiplier).toBe(10);
    expect(saved.currency.reserve).toBe(2_600_000);
    expect(history[history.length - 1].reserve).toBe(2_600_000);
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

  test("a median that breaks the reserve is refused on the median field", async () => {
    const api = createMockApi();
    await settle(api.updateCurrency(OATS.id, { multiplier: 0.01 }));
    const error = await apiErrorOf(
      api.updateCurrency(OATS.id, { weeklyMedian: 0.01 }),
    );

    expect(error.field).toBe("weeklyMedian");
  });

  test("a cleared multiplier is refused on its field, like the API does", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.updateCurrency(OATS.id, {
        weeklyMedian: 50_000,
        multiplier: Number.NaN,
      }),
    );

    expect(error.message).toBe("Enter the reserve multiplier.");
    expect(error.field).toBe("multiplier");
  });

  test("a bad multiplier saves nothing, even with a status change", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.updateCurrency(OATS.id, { active: false, multiplier: 0.001 }),
    );
    const [oats] = await settle(api.listAdminCurrencies());

    expect(error.field).toBe("multiplier");
    expect(oats.currency.active).toBe(true);
    expect(oats.multiplier).toBe(4);
  });

  test("an unknown bot saves nothing, even with a valid median", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.updateCurrency(GEMS.id, { botId: "no-such-bot", weeklyMedian: 1 }),
    );
    const gems = (await settle(api.listAdminCurrencies())).find(
      (entry) => entry.currency.id === GEMS.id,
    );

    expect(error.field).toBe("botId");
    expect(gems?.bot).toBeNull();
    expect(gems?.currency.reserve).toBe(GEMS.reserve);
  });

  test("an unknown currency is a 404", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.updateCurrency("no-such-id", { weeklyMedian: 10 }),
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
    const settings = await settle(api.getBotSettings(TICKET_BOT_ID));

    expect(settings).toEqual({
      hasApiToken: false,
      hasWebhookSecret: false,
      webhookUrl: null,
    });
  });

  test("a webhook URL needs a secret first", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(
      api.setWebhookUrl(TICKET_BOT_ID, "https://bot.example.com/hook"),
    );
    await settle(api.generateWebhookSecret(TICKET_BOT_ID));
    await settle(
      api.setWebhookUrl(TICKET_BOT_ID, "https://bot.example.com/hook"),
    );
    const settings = await settle(api.getBotSettings(TICKET_BOT_ID));

    expect(error.field).toBe("webhookUrl");
    expect(settings.hasWebhookSecret).toBe(true);
    expect(settings.webhookUrl).toBe("https://bot.example.com/hook");
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

  test("pending transactions carry the sender", async () => {
    const api = createMockApi();
    const pending = await settle(api.listPendingTransactions(OAT_BOT_ID));

    expect(pending.every((transaction) => transaction.userId !== "")).toBe(
      true,
    );
  });

  test("the pending list is the bot's, each row naming its currency", async () => {
    const api = createMockApi();
    const pending = await settle(api.listPendingTransactions(TICKET_BOT_ID));

    expect(
      pending.map((transaction) => transaction.toCurrency.abbreviation),
    ).toEqual([TICKETS.abbreviation]);
  });

  test("another owner's bot has no pending list for this user", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.listPendingTransactions(ROCK_BOT_ID));

    expect(error.status).toBe(403);
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
    const { saved } = await settle(
      api.updateCurrency(OATS.id, { active: false }),
    );
    const listed = await settle(api.listCurrencies());
    const mine = await settle(api.listMyTransactions());

    expect(saved.currency.active).toBe(false);
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

    expect(error.status).toBe(409);
    expect(error.field).toBe("discordId");
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

  test("the current user sees their bots and the currencies on them", async () => {
    const api = createMockApi();
    const me = await settle(api.getMe());

    expect(me?.ownedBots).toEqual([
      {
        id: OAT_BOT_ID,
        name: "Harvest bot",
        currencyIds: [OATS.id, SCRAP.id],
      },
      { id: sampleBots[3].id, name: "Ticket bot", currencyIds: [TICKETS.id] },
    ]);
  });

  test("a botless currency has no owner", async () => {
    const api = createMockApi();
    const error = await apiErrorOf(api.getCurrencySettings(GEMS.id));

    expect(error.status).toBe(403);
    expect(error.message).toMatch(/no bot yet/);
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

  test("leak 13: a removed currency leaves every mock list and lookup", async () => {
    const api = createMockApi();
    await settle(api.removeCurrency(OATS.id));

    const listed = await settle(api.listCurrencies());
    const admin = await settle(api.listAdminCurrencies());
    const owned = (await settle(api.listOwnedBots())).flatMap(
      (bot) => bot.currencies,
    );
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
      [lookup, history, trades, quote, edit].map((error) => error.status),
    ).toEqual([404, 404, 404, 404, 404]);
  });

  test("removing a currency cancels its Pending transactions", async () => {
    const api = createMockApi();
    await settle(api.removeCurrency(OATS.id));
    const mine = await settle(api.listMyTransactions());

    expect(
      mine.find((transaction) => transaction.toCurrencyId === OATS.id)?.status,
    ).toBe("Cancelled");
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

  test("removing a bot removes its currencies and leaves the bot list", async () => {
    const api = createMockApi();
    await settle(api.removeBot(ROCK_BOT_ID));
    const bots = await settle(api.listAdminBots());
    const listed = await settle(api.listCurrencies());
    const again = await apiErrorOf(api.removeBot(ROCK_BOT_ID));

    expect(bots.map((bot) => bot.id)).not.toContain(ROCK_BOT_ID);
    expect(listed.map((found) => found.id)).not.toContain(PEBBLES.id);
    expect(again.status).toBe(404);
  });

  test("a removed bot's Discord ID can be used again", async () => {
    const api = createMockApi();
    await settle(api.removeBot(ROCK_BOT_ID));

    const added = await settle(
      api.addBot({ ...NEW_BOT, discordId: ROCK_BOT.discordId }),
    );

    expect(added.discordId).toBe(ROCK_BOT.discordId);
  });

  test("history names a removed sample currency", async () => {
    const api = createMockApi();
    const recent = await settle(api.listRecentTransactions());

    expect(recent.some((transaction) => transaction.fromCurrency.removed)).toBe(
      true,
    );
  });
});
