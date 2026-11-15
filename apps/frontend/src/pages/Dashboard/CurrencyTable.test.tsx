import { render, screen } from "@testing-library/preact";
import { LocationProvider } from "preact-iso";
import { expect, test } from "vitest";

import type { Currency } from "../../api/types.js";
import { CurrencyTable } from "./CurrencyTable.jsx";

function currency(abbreviation: string, valueHistory: number[]): Currency {
  return {
    id: abbreviation,
    abbreviation,
    name: abbreviation,
    reserve: 1_000_000,
    active: true,
    change24h: 0,
    valueHistory,
  };
}

function renderTable(currencies: Currency[]) {
  return render(
    <LocationProvider>
      <CurrencyTable currencies={currencies} />
    </LocationProvider>,
  );
}

test("a currency with one value so far shows New instead of a sparkline", () => {
  renderTable([currency("NEW", [1.5])]);

  expect(screen.getByText("New")).toBeTruthy();
  expect(
    screen.queryByRole("img", { name: /NEW value over 7 days/ }),
  ).toBeNull();
});

test("a currency with history shows its sparkline", () => {
  renderTable([currency("OAT", [1, 2])]);

  expect(
    screen.getByRole("img", { name: /OAT value over 7 days/ }),
  ).toBeTruthy();
});
