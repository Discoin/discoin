import type { Currency } from "../api/types.js";
import { calculatePayout, calculateRequiredAmount } from "./exchange.js";
import { formatAmount } from "./format.js";

export const MAX_SEND_AMOUNT = 1_000_000_000;

export type ConverterSide = "send" | "receive";

export interface ConverterInput {
  from: Currency;
  to: Currency;
  edited: ConverterSide;
  text: string;
}

export interface ConverterError {
  side: ConverterSide;
  message: string;
}

export interface Conversion {
  sendText: string;
  receiveText: string;
  error: ConverterError | undefined;
  effectiveRate: number | undefined;
}

export function parseAmount(text: string): number {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "") return Number.NaN;

  return Number(cleaned);
}

const CENTS = 100;

export function hasAtMostCents(amount: number): boolean {
  return Number.isInteger(Number((amount * CENTS).toFixed(6)));
}

function amountProblem(amount: number): string | undefined {
  if (Number.isNaN(amount)) return "Enter a number, like 1000 or 12.50.";
  if (amount <= 0) return "Enter an amount above 0.";
  if (!hasAtMostCents(amount)) return "Use at most 2 decimals, like 12.50.";

  return undefined;
}

function sendLimitMessage(from: Currency): string {
  return `You can send at most ${formatAmount(MAX_SEND_AMOUNT)} ${from.abbreviation} at once.`;
}

function unconverted(
  input: ConverterInput,
  error: ConverterError | undefined,
): Conversion {
  const isSend = input.edited === "send";

  return {
    sendText: isSend ? input.text : "",
    receiveText: isSend ? "" : input.text,
    error,
    effectiveRate: undefined,
  };
}

function settled(
  input: ConverterInput,
  amount: number,
  payout: number,
): Conversion {
  const isSend = input.edited === "send";

  return {
    sendText: isSend ? input.text : formatAmount(amount),
    receiveText: isSend ? formatAmount(payout) : input.text,
    error: undefined,
    effectiveRate: payout / amount,
  };
}

function convertFromSend(input: ConverterInput, amount: number): Conversion {
  if (amount > MAX_SEND_AMOUNT) {
    return unconverted(input, {
      side: "send",
      message: sendLimitMessage(input.from),
    });
  }

  const payout = calculatePayout(amount, {
    from: input.from.reserve,
    to: input.to.reserve,
  });
  if (payout === 0) {
    return unconverted(input, {
      side: "send",
      message: `This amount is too small to buy any ${input.to.abbreviation}.`,
    });
  }

  return settled(input, amount, payout);
}

function convertFromReceive(input: ConverterInput, payout: number): Conversion {
  const reserves = { from: input.from.reserve, to: input.to.reserve };
  if (payout >= reserves.to) {
    return unconverted(input, {
      side: "receive",
      message: `Enter less than ${formatAmount(reserves.to)} ${input.to.abbreviation}, which is all Discoin holds.`,
    });
  }

  const amount = calculateRequiredAmount(payout, reserves);
  if (amount > MAX_SEND_AMOUNT) {
    return unconverted(input, {
      side: "receive",
      message: sendLimitMessage(input.from),
    });
  }

  return settled(input, amount, calculatePayout(amount, reserves));
}

export function convert(input: ConverterInput): Conversion {
  if (input.text.trim() === "") return unconverted(input, undefined);

  const amount = parseAmount(input.text);
  const problem = amountProblem(amount);
  if (problem !== undefined) {
    return unconverted(input, { side: input.edited, message: problem });
  }

  if (input.edited === "send") return convertFromSend(input, amount);

  return convertFromReceive(input, amount);
}
