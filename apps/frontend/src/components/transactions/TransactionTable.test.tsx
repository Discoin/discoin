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
  rows();

  expect(screen.queryAllByRole("link")).toEqual([]);
});
