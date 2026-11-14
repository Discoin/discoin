import { expect, test } from "vitest";

import {
  changeOver,
  highest,
  lastDays,
  lowest,
  valuePoints,
} from "./valueStats.js";

const POINTS = valuePoints(
  [200_000, 100_000, 125_000, 50_000].map((reserve, day) => ({
    at: `2026-11-1${day}T00:00:00Z`,
    reserve,
  })),
);

test("value is 100,000 divided by the reserve", () => {
  expect(POINTS.map((point) => point.value)).toEqual([0.5, 1, 0.8, 2]);
});

test("the last N days keep N + 1 points so the change spans N days", () => {
  expect(lastDays(POINTS, 2).map((point) => point.value)).toEqual([1, 0.8, 2]);
});

test("a history shorter than the range keeps every point", () => {
  expect(lastDays(POINTS, 30)).toHaveLength(POINTS.length);
});

test("change compares the last value with the first", () => {
  expect(changeOver(POINTS)).toBe(3);
});

test("high and low cover every point", () => {
  expect(highest(POINTS)).toBe(2);
  expect(lowest(POINTS)).toBe(0.5);
});
