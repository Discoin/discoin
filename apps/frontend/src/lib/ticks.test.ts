import { expect, test } from "vitest";

import { niceTicks } from "./ticks.js";

test("ticks land on round steps that cover the data", () => {
  expect(niceTicks(0.0937, 0.1026)).toEqual([0.09, 0.095, 0.1, 0.105]);
});

test("a flat series still gets a visible range around its value", () => {
  expect(niceTicks(80_000, 80_000)).toEqual([70_000, 80_000, 90_000]);
});

test("min above max is rejected", () => {
  expect(() => niceTicks(2, 1)).toThrow(RangeError);
});
