import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, expect, test } from "vitest";

import type { Currency } from "../../api/types.js";
import { ExchangeCalculator } from "./ExchangeCalculator.jsx";

afterEach(cleanup);

function currency(abbreviation: string, reserve: number): Currency {
  return {
    id: abbreviation,
    abbreviation,
    name: abbreviation,
    reserve,
    active: true,
    change24h: 0,
    valueHistory: [],
  };
}

test("rates show at most 3 significant digits", () => {
  render(
    <ExchangeCalculator
      currencies={[currency("OAT", 1_000_000), currency("GEM", 123_456)]}
    />,
  );

  expect(screen.getByText("1 OAT = 0.123 GEM")).toBeTruthy();
  expect(screen.getByText(/This amount gets/).textContent).toContain(
    "0.123 GEM per OAT",
  );
});
