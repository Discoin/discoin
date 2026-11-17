import { cleanup, render, screen, within } from "@testing-library/preact";
import { afterEach, expect, test } from "vitest";

import type { Transaction } from "../../api/types.js";
import { TransactionTable } from "./TransactionTable.jsx";

const OLD_OATS_TRADE: Transaction = {
  id: "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4",
  fromCurrencyId: "019a6f11-7d56-7a11-b3e5-0c98a4d72f6b",
  toCurrencyId: "019a6f10-2c41-7b3e-8d12-5f0a9c7e4b21",
  fromCurrency: { abbreviation: "GEM", name: "Gems", removed: false },
  toCurrency: { abbreviation: "OAT", name: "Oats", removed: true },
  amount: 100,
  payout: 10,
  status: "Completed",
  submittedAt: "2026-11-12T22:41:09Z",
  handledAt: "2026-11-12T22:41:12Z",
};

const NEW_OATS_TRADE: Transaction = {
  ...OLD_OATS_TRADE,
  id: "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d5",
  toCurrencyId: "019a8000-0000-7000-8000-000000000001",
  toCurrency: { abbreviation: "OAT", name: "New oats", removed: false },
};

afterEach(cleanup);

function rows() {
  render(
    <TransactionTable
      caption="Trades"
      transactions={[OLD_OATS_TRADE, NEW_OATS_TRADE]}
    />,
  );

  return screen.getAllByRole("row").slice(1);
}

test("a removed currency shows its name and the word removed", () => {
  const [old] = rows();

  expect(within(old).getByText("10.00 OAT (Oats, removed)")).toBeTruthy();
});

test("a live currency shows its abbreviation only", () => {
  const [, current] = rows();

  expect(within(current).getByText("10.00 OAT")).toBeTruthy();
  expect(within(current).getByText("100.00 GEM")).toBeTruthy();
});

test("a removed currency is plain text, not a link", () => {
  const [old] = rows();
  const received = within(old).getByText("10.00 OAT (Oats, removed)");

  expect(received.querySelector("a")).toBeNull();
  expect(received.closest("a")).toBeNull();
});

test("each transaction ID links to its page, named with the full ID", () => {
  const [old] = rows();
  const link = within(old).getByRole("link");

  expect(link.getAttribute("href")).toBe(`/transactions/${OLD_OATS_TRADE.id}`);
  expect(link.querySelector("[aria-hidden='true']")?.textContent).toBe(
    "a9b6d4",
  );
  expect(
    within(old).getByRole("link", {
      name: `Transaction ${OLD_OATS_TRADE.id}`,
    }),
  ).toBe(link);
});

test("only the ID cell links, so a row action stays a separate control", () => {
  render(
    <TransactionTable
      caption="Pending"
      transactions={[OLD_OATS_TRADE]}
      extraColumns={[
        {
          header: "Webhook",
          render: () => <button type="button">Resend</button>,
        },
      ]}
    />,
  );
  const [row] = screen.getAllByRole("row").slice(1);

  expect(within(row).getAllByRole("link")).toHaveLength(1);
  expect(
    within(row).getByRole("button", { name: "Resend" }).closest("a"),
  ).toBeNull();
});
