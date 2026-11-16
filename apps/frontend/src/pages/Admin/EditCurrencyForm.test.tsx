import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";

import type { AdminCurrency } from "../../api/types.js";
import { EditCurrencyForm } from "./EditCurrencyForm.jsx";

const { updateCurrency } = vi.hoisted(() => ({ updateCurrency: vi.fn() }));

vi.mock("../../api/client.js", () => ({ api: { updateCurrency } }));

const ENTRY: AdminCurrency = {
  currency: {
    id: "019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21",
    abbreviation: "OAT",
    name: "Oats",
    reserve: 400_000,
    active: true,
    change24h: 0,
    valueHistory: [0.25],
  },
  weeklyMedian: 100_000,
  multiplier: 4,
  bot: { id: "oat-bot", name: "Oat bot" },
};

const BOTS = [
  {
    id: "oat-bot",
    name: "Oat bot",
    discordId: "990000000000000001",
    ownerId: "412358906715234305",
    currencyCount: 1,
  },
  {
    id: "gem-bot",
    name: "Gem bot",
    discordId: "990000000000000002",
    ownerId: "412358906715234305",
    currencyCount: 0,
  },
];

afterEach(() => {
  cleanup();
  updateCurrency.mockReset();
});

function renderForm(entry: AdminCurrency = ENTRY) {
  render(
    <EditCurrencyForm
      entry={entry}
      bots={BOTS}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

test("a currency with a bot shows it as text, with no bot field", () => {
  renderForm();

  expect(screen.queryByLabelText("Bot")).toBeNull();
  expect(screen.getByText("Oat bot")).toBeTruthy();
});

function pickBot(botId: string) {
  renderForm({ ...ENTRY, bot: null });
  fireEvent.change(screen.getByLabelText("Bot"), {
    target: { value: botId },
  });
}

test("picking only a bot saves on the first click, with no review", async () => {
  updateCurrency.mockReturnValue(new Promise(() => undefined));
  pickBot("gem-bot");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await vi.waitFor(() =>
    expect(updateCurrency).toHaveBeenCalledWith(ENTRY.currency.id, {
      botId: "gem-bot",
    }),
  );
  expect(screen.queryByText("Review OAT changes")).toBeNull();
});

test("a bot picked with a reserve change shows in the review", () => {
  pickBot("gem-bot");
  fireEvent.input(screen.getByLabelText("Reserve multiplier"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

  const row = screen.getByText("Bot").closest("div");
  expect(row?.textContent).toContain("Gem bot");
  expect(screen.getByText(/can't be changed later/)).toBeTruthy();
});

function reviewNewMultiplier(multiplier: string) {
  renderForm();
  fireEvent.input(screen.getByLabelText("Reserve multiplier"), {
    target: { value: multiplier },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
}

test("the reserve multiplier starts at the currency's own multiplier", () => {
  renderForm();

  expect(
    screen.getByLabelText<HTMLInputElement>("Reserve multiplier").value,
  ).toBe("4");
});

test("a new multiplier shows old and new in the review and warns of the reset", () => {
  reviewNewMultiplier("10");

  const row = screen.getByText("Reserve multiplier").closest("div");
  expect(row?.textContent).toContain("4");
  expect(row?.textContent).toContain("10");
  expect(screen.getByText("This resets the reserve")).toBeTruthy();
  expect(
    screen.getByText("The OAT reserve goes to 1,000,000.00.", { exact: false }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Reset reserve and save" }),
  ).toBeTruthy();
});

test("the review shows the multiplier exactly as it will be sent", () => {
  reviewNewMultiplier("1.234");

  const row = screen.getByText("Reserve multiplier").closest("div");
  expect(row?.textContent).toContain("1.234");
});

test("a multiplier that floors the reserve to 0 says so in the review", () => {
  reviewNewMultiplier("0.00000001");

  expect(
    screen.getByText(
      "This median and multiplier give a reserve below 0.01. Raise one of them.",
    ),
  ).toBeTruthy();
});

test("saving sends only the new multiplier", async () => {
  updateCurrency.mockReturnValue(new Promise(() => undefined));
  reviewNewMultiplier("10");
  fireEvent.click(
    screen.getByRole("button", { name: "Reset reserve and save" }),
  );

  await vi.waitFor(() =>
    expect(updateCurrency).toHaveBeenCalledWith(ENTRY.currency.id, {
      multiplier: 10,
    }),
  );
});
