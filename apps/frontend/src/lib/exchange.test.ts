import { describe, expect, test } from "vitest";

import {
  calculatePayout,
  calculateRequiredAmount,
  currencyValue,
  floorToCents,
  marketRate,
  reservesAfterUndo,
  startingReserve,
} from "./exchange.js";

const RESERVES = { from: 1_000_000, to: 100_000 };

describe("currencyValue", () => {
  test("divides the worth in Discoin by the reserve", () => {
    expect(currencyValue(1_000_000)).toBe(0.1);
  });
});

describe("marketRate", () => {
  test("is the ratio of the two values", () => {
    expect(marketRate(RESERVES)).toBe(0.1);
  });
});

describe("reservesAfterUndo", () => {
  test("runs the payout back through the curve from B to A", () => {
    const payout = calculatePayout(1_000, RESERVES);
    const applied = { from: RESERVES.from + 1_000, to: RESERVES.to - payout };

    expect(reservesAfterUndo(payout, applied)).toEqual({
      from: 1_000_000.01,
      to: 100_000,
    });
  });
});

describe("startingReserve", () => {
  test("is the median times the multiplier, floored to cents", () => {
    expect(startingReserve(25_000, 10)).toBe(250_000);
    expect(startingReserve(0.15, 0.15)).toBe(0.02);
  });
});

describe("floorToCents", () => {
  test("ignores floating point noise", () => {
    expect(floorToCents(0.29)).toBe(0.29);
  });
});

describe("calculatePayout", () => {
  test("matches the worked example in the plan", () => {
    expect(calculatePayout(1_000, RESERVES)).toBe(99.9);
  });

  test("rounds down to cents", () => {
    expect(calculatePayout(250, { from: 1_000_000, to: 14_285_714.29 })).toBe(
      3570.53,
    );
  });

  test("never pays out the whole target reserve", () => {
    expect(calculatePayout(1_000_000_000, { from: 100, to: 0.5 })).toBeLessThan(
      0.5,
    );
  });
});

describe("calculateRequiredAmount", () => {
  test("gives the amount that pays out exactly the asked payout", () => {
    const required = calculateRequiredAmount(99.9, RESERVES);

    expect(required).toBe(1_000);
    expect(calculatePayout(required, RESERVES)).toBe(99.9);
  });

  test.each([1, 12.34, 5_000, 99_999.99])(
    "always reaches a payout of at least %s",
    (payout) => {
      const required = calculateRequiredAmount(payout, RESERVES);

      expect(calculatePayout(required, RESERVES)).toBeGreaterThanOrEqual(
        payout,
      );
    },
  );

  test("rejects a payout the reserve can't cover", () => {
    expect(() => calculateRequiredAmount(100_000, RESERVES)).toThrow(
      RangeError,
    );
  });
});
