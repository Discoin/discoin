import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

import type { BlockListApi } from "../../api/client.js";
import { ApiError, ConnectionError } from "../../api/errors.js";
import type {
  BotWithCurrencies,
  Currency,
  CurrentUser,
  PendingTransaction,
} from "../../api/types.js";
import { SessionProvider } from "../../components/session/SessionProvider.jsx";
import { toasts } from "../../lib/toasts.js";
import { NO_ANSWER_MESSAGE } from "../../lib/useAction.js";
import { BotOwner } from "./index.jsx";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  listOwnedBots: vi.fn(),
  getBotSettings: vi.fn(),
  getCurrencySettings: vi.fn(),
  listPendingTransactions: vi.fn(),
  botBlocks: vi.fn(),
  updateCurrencyDetails: vi.fn(),
  setDailyCap: vi.fn(),
  regenerateApiToken: vi.fn(),
  generateWebhookSecret: vi.fn(),
  testWebhook: vi.fn(),
  listBlocks: vi.fn(),
}));

vi.mock("../../api/client.js", () => ({
  LOGIN_PATH: "/api/auth/discord/login",
  api,
}));

const USER: CurrentUser = {
  userId: "412358906715234305",
  username: "coinkeeper",
  avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
  defaultAvatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
  isAdmin: false,
  ownedBots: [],
};

function currencyOf(abbreviation: string, name: string): Currency {
  return {
    id: abbreviation.toLowerCase(),
    abbreviation,
    name,
    reserve: 1_000_000,
    active: true,
    change24h: 0,
    valueHistory: [1, 1],
  };
}

const OATS = currencyOf("OAT", "Oats");
const SCRAP = currencyOf("SCR", "Scrap");
const RETIRED = { ...currencyOf("OLD", "Old coins"), active: false };
const TICKETS = currencyOf("TKT", "Tickets");
const HARVEST: BotWithCurrencies = {
  id: "harvest",
  name: "Harvest bot",
  currencies: [SCRAP, OATS, RETIRED],
};
const TICKET: BotWithCurrencies = {
  id: "ticket",
  name: "Ticket bot",
  currencies: [TICKETS],
};
const NEW_HOOK = "https://new.example.com/hook";
const SCRAP_OPTION = /^SCR\s?Scrap$/;

function pendingInto(id: string, into: Currency): PendingTransaction {
  return {
    id,
    fromCurrencyId: "gem",
    toCurrencyId: into.id,
    fromCurrency: { abbreviation: "GEM", name: "Gems", removed: false },
    toCurrency: {
      abbreviation: into.abbreviation,
      name: into.name,
      removed: false,
    },
    amount: 10,
    payout: 5,
    status: "Pending",
    submittedAt: "2026-11-12T22:41:09Z",
    handledAt: null,
    userId: "530917284650193847",
  };
}

const PENDING: Record<string, PendingTransaction[]> = {
  harvest: [
    pendingInto("019a7c3e-0000-7000-8000-00000000a001", OATS),
    pendingInto("019a7c3e-0000-7000-8000-00000000a002", SCRAP),
  ],
  ticket: [pendingInto("019a7c3e-0000-7000-8000-00000000b001", TICKETS)],
};

function blockListOf(botId: string): BlockListApi {
  return {
    level: "bot",
    list: () => api.listBlocks(botId),
    block: vi.fn(),
    previewBlock: vi.fn(),
    unblock: vi.fn(),
  };
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  api.getMe.mockResolvedValue(USER);
  api.listOwnedBots.mockResolvedValue([HARVEST, TICKET]);
  api.getBotSettings.mockImplementation((botId: string) =>
    Promise.resolve({
      hasApiToken: true,
      hasWebhookSecret: true,
      webhookUrl: `https://${botId}.example.com/hook`,
    }),
  );
  api.getCurrencySettings.mockImplementation((currencyId: string) =>
    Promise.resolve({ dailyCap: currencyId === "oat" ? 5000 : null }),
  );
  api.listPendingTransactions.mockImplementation((botId: string) =>
    Promise.resolve(PENDING[botId]),
  );
  api.listBlocks.mockResolvedValue([]);
  api.regenerateApiToken.mockResolvedValue("dsc_newtoken");
  api.generateWebhookSecret.mockResolvedValue("whsec_newsecret");
  api.botBlocks.mockImplementation(blockListOf);
  api.updateCurrencyDetails.mockImplementation(
    (currencyId: string, details: { name: string; abbreviation: string }) =>
      Promise.resolve({
        ...currencyOf("OAT", "Oats"),
        id: currencyId,
        ...details,
      }),
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function waitForSections() {
  await waitFor(() => expect(screen.queryByText(/^Loading/)).toBeNull());
}

async function renderPage() {
  render(
    <SessionProvider>
      <BotOwner />
    </SessionProvider>,
  );
  await screen.findByRole("heading", { level: 2, name: /^Bot/ });
  await waitForSections();
}

function picker(name: string) {
  return screen.getByRole("combobox", { name });
}

function choose(pickerName: string, option: string | RegExp) {
  fireEvent.click(picker(pickerName));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

function group(name: RegExp) {
  return screen.getByRole("region", { name });
}

function webhookField() {
  return screen.getByLabelText<HTMLInputElement>("Receipt webhook URL");
}

function typeInto(field: HTMLInputElement, value: string) {
  fireEvent.input(field, { target: { value } });
}

function requestCount(fn: { mock: { calls: unknown[][] } }, id: string) {
  return fn.mock.calls.filter(([calledWith]) => calledWith === id).length;
}

function botRequestCounts(botId: string) {
  return [
    requestCount(api.getBotSettings, botId),
    requestCount(api.listPendingTransactions, botId),
    requestCount(api.listBlocks, botId),
  ];
}

test("the first bot and its first active currency by abbreviation load first", async () => {
  await renderPage();

  expect(picker("Bot").textContent).toBe("Harvest bot");
  expect(within(picker("Currency")).getByText("OAT")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Currency name").value).toBe(
    "Oats",
  );
});

test("an inactive currency isn't listed", async () => {
  await renderPage();
  fireEvent.click(picker("Currency"));

  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["OATOats", "SCRScrap"]);
});

test("the bot's pending list covers all its currencies with a currency column", async () => {
  await renderPage();
  const table = screen.getByRole("table", { name: "Pending transactions" });
  const headers = within(table)
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
  const currencies = within(table)
    .getAllByRole("row")
    .slice(1)
    .map(
      (row) => within(row).getAllByRole("cell")[headers.indexOf("Currency")],
    );

  expect(currencies.map((cell) => cell.textContent)).toEqual(["OAT", "SCR"]);
});

test("switching currency changes only the currency group", async () => {
  await renderPage();
  const countsBefore = botRequestCounts("harvest");
  typeInto(webhookField(), NEW_HOOK);

  choose("Currency", SCRAP_OPTION);
  await waitForSections();

  expect(screen.getByLabelText<HTMLInputElement>("Currency name").value).toBe(
    "Scrap",
  );
  expect(webhookField().value).toBe(NEW_HOOK);
  expect(botRequestCounts("harvest")).toEqual(countsBefore);
  expect(api.getCurrencySettings).toHaveBeenLastCalledWith("scr");
});

test("switching currency keeps an open block form and its input", async () => {
  await renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Block a user" }));
  const userId = screen.getByLabelText<HTMLInputElement>("Discord user ID");
  typeInto(userId, "700000000000000001");

  choose("Currency", SCRAP_OPTION);
  await waitForSections();

  expect(
    screen.getByRole("dialog", { name: "Block a user from Harvest bot" }),
  ).toBeTruthy();
  expect(userId.value).toBe("700000000000000001");
  expect(requestCount(api.listBlocks, "harvest")).toBe(1);
});

test("switching bot changes the bot group and picks that bot's first currency", async () => {
  await renderPage();

  choose("Bot", "Ticket bot");
  await waitForSections();

  expect(webhookField().value).toBe("https://ticket.example.com/hook");
  expect(screen.queryByRole("combobox", { name: "Currency" })).toBeNull();
  expect(
    screen.getByRole("heading", { level: 2, name: "Currency: TKT (Tickets)" }),
  ).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Currency name").value).toBe(
    "Tickets",
  );
  expect(
    screen.getByRole("heading", { name: "Blocked users" }).closest("section")
      ?.textContent,
  ).toContain("any currency Ticket bot runs");
});

test("each section shows its own loading state for the new selection only", async () => {
  await renderPage();
  api.getCurrencySettings.mockReturnValue(never());

  choose("Currency", SCRAP_OPTION);

  expect(await screen.findByText("Loading the daily cap")).toBeTruthy();
  expect(screen.queryByText("Loading the webhook")).toBeNull();
  expect(screen.queryByLabelText("Daily cap per user")).toBeNull();
});

test("a failed section shows its error with a retry, never defaults", async () => {
  await renderPage();
  api.getBotSettings.mockRejectedValueOnce(new Error("Discoin is down."));

  choose("Bot", "Ticket bot");

  expect(await screen.findByText("Couldn't load the webhook")).toBeTruthy();
  expect(screen.getByText("Couldn't load the API token")).toBeTruthy();
  expect(screen.queryByLabelText("Receipt webhook URL")).toBeNull();

  fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
  await waitForSections();

  expect(webhookField().value).toBe("https://ticket.example.com/hook");
});

test.each([
  { form: "bot", field: () => webhookField(), listed: "Webhook URL" },
  {
    form: "currency",
    field: () => screen.getByLabelText<HTMLInputElement>("Daily cap per user"),
    listed: "Daily cap",
  },
])(
  "an unsaved $form form asks before a bot switch and names what it discards",
  async ({ field, listed }) => {
    await renderPage();
    typeInto(field(), "250");

    choose("Bot", "Ticket bot");
    const dialog = screen.getByRole("dialog", {
      name: "Discard unsaved changes?",
    });

    expect(within(dialog).getByText(listed)).toBeTruthy();
    expect(
      within(dialog).getByText("Switching to Ticket bot discards them."),
    ).toBeTruthy();
  },
);

test("an unsaved currency form asks before a currency switch", async () => {
  await renderPage();
  typeInto(screen.getByLabelText("Currency name"), "Rolled oats");
  picker("Currency").focus();

  choose("Currency", SCRAP_OPTION);
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

  expect(screen.getByLabelText<HTMLInputElement>("Currency name").value).toBe(
    "Rolled oats",
  );
  expect(document.activeElement).toBe(picker("Currency"));
});

test("an unsaved bot form doesn't hold up a currency switch", async () => {
  await renderPage();
  typeInto(webhookField(), NEW_HOOK);

  choose("Currency", SCRAP_OPTION);

  expect(screen.queryByRole("dialog")).toBeNull();
  await waitForSections();
  expect(screen.getByLabelText<HTMLInputElement>("Currency name").value).toBe(
    "Scrap",
  );
});

test("a form of a bot switched to counts as unsaved like the first", async () => {
  await renderPage();
  choose("Bot", "Ticket bot");
  await waitForSections();
  typeInto(webhookField(), NEW_HOOK);

  choose("Bot", "Harvest bot");

  expect(
    within(screen.getByRole("dialog")).getByText("Webhook URL"),
  ).toBeTruthy();
});

async function renameOats() {
  typeInto(screen.getByLabelText("Currency name"), "Rolled oats");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await within(picker("Currency")).findByText("Rolled oats");
}

test("a saved form no longer counts as unsaved", async () => {
  await renderPage();
  await renameOats();

  choose("Bot", "Ticket bot");

  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a rename updates the picker without announcing a currency change", async () => {
  await renderPage();
  await renameOats();

  fireEvent.click(picker("Currency"));

  expect(
    screen.getByRole("option", { name: /^OAT\s?Rolled oats$/, selected: true }),
  ).toBeTruthy();
  const pickerStatus = within(
    picker("Currency").closest(".picker") as HTMLElement,
  ).getByRole("status");
  expect(pickerStatus.textContent).toBe("");
});

function inactiveRefusal(currency: Currency): ApiError {
  return new ApiError(
    400,
    `${currency.abbreviation} is inactive, so its settings can't be changed until a Discoin admin reactivates it.`,
    "currencyId",
  );
}

async function renameFindingItDeactivated(currency: Currency) {
  api.updateCurrencyDetails.mockRejectedValueOnce(inactiveRefusal(currency));
  typeInto(screen.getByLabelText("Currency name"), "Renamed");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(`${currency.abbreviation} is inactive`);
}

test("a currency deactivated while selected stays selected with a message", async () => {
  await renderPage();
  typeInto(webhookField(), NEW_HOOK);

  await renameFindingItDeactivated(OATS);

  expect(screen.queryByLabelText("Currency name")).toBeNull();
  expect(screen.queryByLabelText("Daily cap per user")).toBeNull();
  expect(group(/^Currency/).textContent).toContain(
    "stay hidden here until an admin reactivates it",
  );
  expect(within(picker("Currency")).getByText("Inactive")).toBeTruthy();
  expect(webhookField().value).toBe(NEW_HOOK);
  expect(api.listOwnedBots).toHaveBeenCalledTimes(1);
  expect(document.activeElement?.textContent).toContain("OAT is inactive");
});

test("from a deactivated currency the owner can switch to an active one", async () => {
  await renderPage();
  await renameFindingItDeactivated(OATS);

  choose("Currency", SCRAP_OPTION);
  await waitForSections();

  expect(screen.getByLabelText<HTMLInputElement>("Currency name").value).toBe(
    "Scrap",
  );
  expect(screen.queryByRole("combobox", { name: "Currency" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { level: 2, name: "Currency: SCR (Scrap)" }),
  );
});

test("a daily cap refused because the currency became inactive shows the inactive message", async () => {
  await renderPage();
  api.setDailyCap.mockRejectedValueOnce(inactiveRefusal(OATS));

  typeInto(screen.getByLabelText("Daily cap per user"), "250");
  fireEvent.click(screen.getByRole("button", { name: "Save daily cap" }));

  expect(await screen.findByText("OAT is inactive")).toBeTruthy();
  expect(document.activeElement?.textContent).toContain("OAT is inactive");
  expect(within(picker("Currency")).getByText("Inactive")).toBeTruthy();
  expect(screen.queryByLabelText("Daily cap per user")).toBeNull();
});

test("a new abbreviation or a deactivation reloads the pending list", async () => {
  await renderPage();
  typeInto(screen.getByLabelText("Abbreviation"), "ROAT");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await within(picker("Currency")).findByText("ROAT");
  await waitForSections();
  const afterRename = requestCount(api.listPendingTransactions, "harvest");

  await renameFindingItDeactivated({ ...OATS, abbreviation: "ROAT" });
  await waitForSections();

  expect(afterRename).toBe(2);
  expect(requestCount(api.listPendingTransactions, "harvest")).toBe(3);
});

test.each([
  {
    name: "got no answer",
    error: new ConnectionError(
      "Couldn't reach the Discoin API: Failed to fetch",
    ),
    shown: NO_ANSWER_MESSAGE,
  },
  {
    name: "was refused",
    error: new ApiError(409, "That name is taken.", "name"),
    shown: "That name is taken.",
  },
])(
  "a save that $name frees the pickers and keeps the form unsaved",
  async ({ error, shown }) => {
    await renderPage();
    api.updateCurrencyDetails.mockRejectedValueOnce(error);

    startRename("Rolled oats");

    expect(await screen.findAllByText(shown)).not.toHaveLength(0);
    expect(picker("Bot").hasAttribute("aria-disabled")).toBe(false);
    choose("Bot", "Ticket bot");
    expect(
      within(screen.getByRole("dialog")).getByText("Name and abbreviation"),
    ).toBeTruthy();
  },
);

test("a bot's only currency deactivated while selected shows the message", async () => {
  api.listOwnedBots.mockResolvedValue([TICKET]);
  await renderPage();

  await renameFindingItDeactivated(TICKETS);

  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: "Currency: TKT (Tickets), inactive",
    }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "API token" })).toBeTruthy();
});

function pendingSave() {
  let finish: (saved: Currency) => void = () => undefined;
  api.updateCurrencyDetails.mockImplementationOnce(
    () =>
      new Promise<Currency>((resolve) => {
        finish = resolve;
      }),
  );

  return { finish: (saved: Currency) => finish(saved) };
}

function startRename(name: string) {
  typeInto(screen.getByLabelText("Currency name"), name);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

test("the pickers say they're busy and don't switch while a save is sent", async () => {
  await renderPage();
  const save = pendingSave();
  startRename("Rolled oats");

  await waitFor(() =>
    expect(picker("Bot").getAttribute("aria-disabled")).toBe("true"),
  );
  expect(picker("Currency").getAttribute("aria-disabled")).toBe("true");
  expect(
    document.getElementById(
      picker("Bot").getAttribute("aria-describedby") ?? "",
    )?.textContent,
  ).toBe("Saving your changes. You can switch once the save finishes.");
  fireEvent.click(picker("Bot"));
  expect(screen.queryByRole("listbox")).toBeNull();

  save.finish({ ...OATS, name: "Rolled oats" });
  await within(picker("Currency")).findByText("Rolled oats");

  expect(picker("Bot").hasAttribute("aria-disabled")).toBe(false);
  choose("Bot", "Ticket bot");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(picker("Bot").textContent).toBe("Ticket bot");
});

async function regenerate(secret: string, confirmLabel: string) {
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`^Regenerate\\s?${secret}$`),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: confirmLabel }));
  await screen.findAllByText("Copy it now. Discoin only shows it once.");
}

test.each([
  ["API token", "Regenerate token", "I've copied the token"],
  ["Webhook secret", "Regenerate secret", "I've copied the secret"],
])(
  "a shown %s asks before a bot switch until it's dismissed",
  async (secret, confirmLabel, dismissLabel) => {
    await renderPage();
    await regenerate(secret, confirmLabel);

    choose("Currency", SCRAP_OPTION);
    expect(screen.queryByRole("dialog")).toBeNull();

    choose("Bot", "Ticket bot");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(secret)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );

    fireEvent.click(screen.getByRole("button", { name: dismissLabel }));
    choose("Bot", "Ticket bot");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(picker("Bot").textContent).toBe("Ticket bot");
  },
);

test("one bot hides the bot picker and names the bot in its heading", async () => {
  api.listOwnedBots.mockResolvedValue([HARVEST]);
  await renderPage();

  expect(screen.queryByRole("combobox", { name: "Bot" })).toBeNull();
  expect(
    screen.getByRole("heading", { level: 2, name: "Bot: Harvest bot" }),
  ).toBeTruthy();
  expect(picker("Currency")).toBeTruthy();
});

test("one bot with one currency shows no picker row and names both", async () => {
  api.listOwnedBots.mockResolvedValue([TICKET]);
  await renderPage();

  expect(screen.queryByRole("combobox")).toBeNull();
  expect(document.querySelector(".owner-pickers")).toBeNull();
  expect(
    screen.getByRole("heading", { level: 2, name: "Bot: Ticket bot" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "Currency: TKT (Tickets)" }),
  ).toBeTruthy();
});

test("an owner with no bots sees the empty state", async () => {
  api.listOwnedBots.mockResolvedValue([]);
  render(
    <SessionProvider>
      <BotOwner />
    </SessionProvider>,
  );

  expect(await screen.findByText("You don't own a bot yet")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
});

test("a bot with no currency keeps its bot sections and says so", async () => {
  api.listOwnedBots.mockResolvedValue([
    HARVEST,
    { id: "empty", name: "Empty bot", currencies: [] },
  ]);
  api.listPendingTransactions.mockResolvedValue([]);
  await renderPage();

  choose("Bot", "Empty bot");
  await waitForSections();

  expect(screen.queryByRole("combobox", { name: "Currency" })).toBeNull();
  expect(group(/^Currency/).textContent).toContain(
    "This bot has no currency yet",
  );
  expect(webhookField().value).toBe("https://empty.example.com/hook");
});

test("a bot whose currencies are all inactive says so", async () => {
  api.listOwnedBots.mockResolvedValue([
    { id: "dormant", name: "Dormant bot", currencies: [RETIRED] },
  ]);
  api.listPendingTransactions.mockResolvedValue([]);
  await renderPage();

  expect(group(/^Currency/).textContent).toContain(
    "Every currency of this bot is inactive",
  );
  expect(screen.queryByLabelText("Currency name")).toBeNull();
  expect(screen.getByRole("heading", { name: "API token" })).toBeTruthy();
});

test.each([
  {
    name: "a saved webhook URL",
    webhookUrl: "https://harvest.example.com/hook",
    button: /^Test\s?webhook$/,
    answer: 204,
    shown: "Test sent. Your webhook answered 204.",
  },
  {
    name: "no webhook URL",
    webhookUrl: null,
    button: /^Test\s?event feed$/,
    answer: null,
    shown:
      "Test event added to your event feed. Your bot gets it on its next read.",
  },
])(
  "Test with $name says where the test event went",
  async ({ webhookUrl, button, answer, shown }) => {
    api.getBotSettings.mockResolvedValue({
      hasApiToken: true,
      hasWebhookSecret: true,
      webhookUrl,
    });
    api.testWebhook.mockResolvedValue(answer);
    const showToast = vi.spyOn(toasts, "show");
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: button }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(shown));
    expect(api.testWebhook).toHaveBeenCalledWith("harvest");
  },
);

test("the webhook field says a URL switches the event feed off", async () => {
  await renderPage();

  expect(
    screen.getByText(
      /With a webhook URL, events are sent to it and the event feed is switched off\.$/,
    ),
  ).toBeTruthy();
});
