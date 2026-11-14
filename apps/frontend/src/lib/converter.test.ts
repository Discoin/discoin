import { describe, expect, test } from "vitest";

import type { Currency } from "../api/types.js";
import { convert, parseAmount, type ConverterInput } from "./converter.js";

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

const OAT = currency("OAT", 1_000_000);
const GEM = currency("GEM", 100_000);

function input(edited: ConverterInput["edited"], text: string): ConverterInput {
  return { from: OAT, to: GEM, edited, text };
}

describe("parseAmount", () => {
  test("accepts grouped numbers", () => {
    expect(parseAmount("1,000.50")).toBe(1000.5);
  });

  test("rejects text with trailing junk", () => {
    expect(parseAmount("12abc")).toBeNaN();
  });
});

describe("convert", () => {
  test("fills what they receive from what you send", () => {
    const result = convert(input("send", "1000"));

    expect(result.sendText).toBe("1000");
    expect(result.receiveText).toBe("99.90");
    expect(result.error).toBeUndefined();
  });

  test("fills what you send from what they receive", () => {
    const result = convert(input("receive", "99.90"));

    expect(result.sendText).toBe("1,000.00");
    expect(result.receiveText).toBe("99.90");
  });

  test("leaves the other side empty while the edited side is empty", () => {
    const result = convert(input("receive", ""));

    expect(result.sendText).toBe("");
    expect(result.error).toBeUndefined();
  });

  test("flags text that isn't a number on the side being edited", () => {
    const result = convert(input("send", "abc"));

    expect(result.error?.side).toBe("send");
    expect(result.receiveText).toBe("");
  });

  test("flags more than 2 decimals, like the API", () => {
    const result = convert(input("send", "1.005"));

    expect(result.error?.message).toBe("Use at most 2 decimals, like 12.50.");
  });

  test("accepts exactly 2 decimals", () => {
    expect(convert(input("send", "0.29")).error).toBeUndefined();
  });

  test("flags a payout the target reserve can't cover", () => {
    const result = convert(input("receive", "100000"));

    expect(result.error?.side).toBe("receive");
    expect(result.sendText).toBe("");
  });

  test("flags an amount above the sending limit", () => {
    const result = convert(input("send", "2000000000"));

    expect(result.error?.message).toMatch(/at most/);
  });

  test("reports the rate this amount actually gets", () => {
    const result = convert(input("send", "1000"));

    expect(result.effectiveRate).toBeCloseTo(0.0999, 6);
  });
});
