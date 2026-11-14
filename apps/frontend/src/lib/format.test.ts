import { describe, expect, test } from "vitest";

import {
  formatAmount,
  formatAxisAmount,
  formatChange,
  formatLiquidity,
  formatShortDate,
  formatTimestamp,
  formatValue,
  shortTransactionId,
} from "./format.js";

describe("formatValue", () => {
  test("shows 4 decimals so columns line up", () => {
    expect(formatValue(0.007)).toBe("0.0070");
    expect(formatValue(0.1)).toBe("0.1000");
    expect(formatValue(1.25)).toBe("1.2500");
  });
});

describe("formatAmount", () => {
  test("shows 2 decimals with grouping", () => {
    expect(formatAmount(1428.57)).toBe("1,428.57");
    expect(formatAmount(250)).toBe("250.00");
  });

  test("uses a real minus sign", () => {
    expect(formatAmount(-3)).toBe("−3.00");
  });
});

describe("formatLiquidity", () => {
  test("shortens thousands, millions and billions", () => {
    expect(formatLiquidity(950_000)).toBe("950K");
    expect(formatLiquidity(1_000_000)).toBe("1M");
    expect(formatLiquidity(1_250_000)).toBe("1.25M");
    expect(formatLiquidity(2_500_000_000)).toBe("2.5B");
  });

  test("leaves amounts below 1,000 as they are, up to 2 decimals", () => {
    expect(formatLiquidity(999)).toBe("999");
    expect(formatLiquidity(12.5)).toBe("12.5");
  });

  test("rounds to at most 2 decimals", () => {
    expect(formatLiquidity(3_571_428.57)).toBe("3.57M");
    expect(formatLiquidity(1_236_000)).toBe("1.24M");
    expect(formatLiquidity(14_285_714.29)).toBe("14.29M");
  });

  test("refuses amounts that aren't numbers", () => {
    expect(() => formatLiquidity(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatChange", () => {
  test("signs the change and uses a real minus sign", () => {
    expect(formatChange(0.021)).toBe("+2.1%");
    expect(formatChange(-0.004)).toBe("−0.4%");
    expect(formatChange(0)).toBe("0.0%");
  });
});

describe("formatTimestamp", () => {
  test("shows the UTC time to the minute", () => {
    expect(formatTimestamp("2026-11-12T22:41:09Z")).toBe(
      "2026-11-12 22:41 UTC",
    );
  });

  test("rejects an invalid timestamp", () => {
    expect(() => formatTimestamp("not a date")).toThrow(RangeError);
  });
});

describe("shortTransactionId", () => {
  test("keeps the last 6 characters, like a short commit hash", () => {
    expect(shortTransactionId("019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4")).toBe(
      "a9b6d4",
    );
  });
});

test("axis amounts keep enough digits to tell nearby ticks apart", () => {
  expect(
    [950_000, 1_000_000, 1_050_000, 1_100_000].map(formatAxisAmount),
  ).toEqual(["950K", "1M", "1.05M", "1.1M"]);
});

test("short dates show month and day in UTC", () => {
  expect(formatShortDate("2026-11-13T00:00:00Z")).toBe("Nov 13");
});
