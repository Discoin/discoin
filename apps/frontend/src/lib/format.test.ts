import { describe, expect, test } from "vitest";

import {
  formatAmount,
  formatAxisAmount,
  formatAxisValues,
  formatChange,
  formatLiquidity,
  formatMultiplier,
  formatShortDate,
  formatTimestamp,
  formatValue,
  shortTransactionId,
} from "./format.js";
import { niceTicks } from "./ticks.js";

describe("formatValue", () => {
  test.each([
    [12_345.67, "12,300"],
    [1_234.5, "1,230"],
    [999.5, "1,000"],
    [100, "100"],
    [1.2345, "1.23"],
    [1, "1"],
    [0.1, "0.1"],
    [0.1004, "0.1"],
    [0.007, "0.007"],
    [0.00012345, "0.000123"],
    [1e7, "10,000,000"],
    [1e-9, "0.000000001"],
    [0, "0"],
  ])("shows %s with at most 3 significant digits as %s", (value, shown) => {
    expect(formatValue(value)).toBe(shown);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY])("refuses %s", (value) => {
    expect(() => formatValue(value)).toThrow(RangeError);
  });
});

describe("formatAxisValues", () => {
  test("gives every tick the same decimals and writes each one exactly", () => {
    expect(formatAxisValues([0.09, 0.095, 0.1, 0.105])).toEqual([
      "0.090",
      "0.095",
      "0.100",
      "0.105",
    ]);
  });

  test("keeps ticks apart that 3 significant digits would merge", () => {
    expect(formatAxisValues([12_340, 12_345, 12_350])).toEqual([
      "12,340",
      "12,345",
      "12,350",
    ]);
  });

  test("leaves round ticks without decimals", () => {
    expect(formatAxisValues([70_000, 80_000, 90_000])).toEqual([
      "70,000",
      "80,000",
      "90,000",
    ]);
  });

  test("writes tiny ticks out in full", () => {
    expect(formatAxisValues([1e-9, 2e-9])).toEqual([
      "0.000000001",
      "0.000000002",
    ]);
  });

  test("never gives two ticks the same label, from 1e-9 to 1e7", () => {
    for (let exponent = -9; exponent <= 7; exponent++) {
      const low = 1.2345 * 10 ** exponent;
      const ticks = niceTicks(low, low * 1.01);
      const labels = formatAxisValues(ticks);

      expect(new Set(labels).size).toBe(ticks.length);
      expect(labels.map((label) => Number(label.replace(/,/g, "")))).toEqual(
        ticks,
      );
    }
  });
});

describe("formatMultiplier", () => {
  test("shows the multiplier exactly, without trailing zeros", () => {
    expect(formatMultiplier(10)).toBe("10");
    expect(formatMultiplier(2.5)).toBe("2.5");
    expect(formatMultiplier(1.234)).toBe("1.234");
    expect(formatMultiplier(1_000.5)).toBe("1,000.5");
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
