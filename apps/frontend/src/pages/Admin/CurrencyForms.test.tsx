import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";

import { ApiError } from "../../api/errors.js";
import { AddCurrencyForm } from "./CurrencyForms.jsx";

const { addCurrency } = vi.hoisted(() => ({ addCurrency: vi.fn() }));

vi.mock("../../api/client.js", () => ({ api: { addCurrency } }));

afterEach(() => {
  cleanup();
  addCurrency.mockReset();
});

const BOTS = [
  {
    id: "oat-bot",
    name: "Oat bot",
    discordId: "990000000000000001",
    ownerId: "412358906715234305",
    currencyCount: 1,
  },
];

function renderForm() {
  render(<AddCurrencyForm bots={BOTS} onAdded={vi.fn()} onCancel={vi.fn()} />);
}

function type(label: string, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

test("the reserve multiplier is a labelled field that starts at 10", () => {
  renderForm();

  expect(
    screen.getByLabelText<HTMLInputElement>("Reserve multiplier").value,
  ).toBe("10");
});

test("the reserve preview uses the typed multiplier", () => {
  renderForm();
  type("Abbreviation", "oat");
  type("Weekly income median", "25000");
  type("Reserve multiplier", "2.5");

  expect(
    screen.getByText(
      "The reserve starts at 62,500.00 OAT, so one OAT starts with a value of 1.6.",
    ),
  ).toBeTruthy();
});

test("the preview names the multiplier while the median is still empty", () => {
  renderForm();

  expect(
    screen.getByText("The reserve starts at 10 times the weekly median."),
  ).toBeTruthy();
});

test("the multiplier is sent with the new currency", async () => {
  addCurrency.mockReturnValue(new Promise(() => undefined));
  renderForm();
  type("Weekly income median", "25000");
  type("Reserve multiplier", "4");
  fireEvent.click(screen.getByRole("button", { name: "Add currency" }));

  await vi.waitFor(() =>
    expect(addCurrency).toHaveBeenCalledWith(
      expect.objectContaining({ weeklyMedian: 25_000, multiplier: 4 }),
    ),
  );
});

test("no bot is picked at first, and that is sent so the API can refuse it", async () => {
  addCurrency.mockReturnValue(new Promise(() => undefined));
  renderForm();
  fireEvent.click(screen.getByRole("button", { name: "Add currency" }));

  expect(screen.getByLabelText<HTMLSelectElement>("Bot").value).toBe("");
  await vi.waitFor(() =>
    expect(addCurrency).toHaveBeenCalledWith(
      expect.objectContaining({ botId: null }),
    ),
  );
});

test("the picked bot is sent with the new currency", async () => {
  addCurrency.mockReturnValue(new Promise(() => undefined));
  renderForm();
  fireEvent.change(screen.getByLabelText("Bot"), {
    target: { value: "oat-bot" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add currency" }));

  await vi.waitFor(() =>
    expect(addCurrency).toHaveBeenCalledWith(
      expect.objectContaining({ botId: "oat-bot" }),
    ),
  );
});

test("a missing bot shows on the Bot field", async () => {
  addCurrency.mockRejectedValue(
    new ApiError(400, "Pick the bot that runs this currency.", "botId"),
  );
  renderForm();
  fireEvent.click(screen.getByRole("button", { name: "Add currency" }));

  const field = screen.getByLabelText("Bot");
  await vi.waitFor(() =>
    expect(field.getAttribute("aria-invalid")).toBe("true"),
  );
});

test("an API error on the multiplier shows on its field", async () => {
  addCurrency.mockRejectedValue(
    new ApiError(400, "The reserve multiplier must be above 0.", "multiplier"),
  );
  renderForm();
  type("Reserve multiplier", "0");
  fireEvent.click(screen.getByRole("button", { name: "Add currency" }));

  const field = screen.getByLabelText("Reserve multiplier");
  await vi.waitFor(() =>
    expect(field.getAttribute("aria-invalid")).toBe("true"),
  );
  expect(
    screen.getByText("The reserve multiplier must be above 0.", {
      selector: ".field__message",
    }).id,
  ).toBe(field.getAttribute("aria-describedby"));
});
