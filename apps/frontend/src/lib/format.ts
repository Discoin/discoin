const LOCALE = "en-US";
const MINUS_SIGN = "−";
const SHORT_ID_LENGTH = 6;
const VALUE_SIGNIFICANT_DIGITS = 3;

const valueFormat = new Intl.NumberFormat(LOCALE, {
  maximumSignificantDigits: VALUE_SIGNIFICANT_DIGITS,
});

const EXACT_FRACTION_DIGITS = 20;

const multiplierFormat = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: EXACT_FRACTION_DIGITS,
});

const amountFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const liquidityFormat = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 2,
});

const changeFormat = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

const countFormat = new Intl.NumberFormat(LOCALE);

export function formatQuantity(count: number): string {
  return countFormat.format(count);
}

function formatCount(count: number, singular: string): string {
  const noun = count === 1 ? singular : `${singular}s`;

  return `${formatQuantity(count)} ${noun}`;
}

export function formatTransactionCount(count: number): string {
  return formatCount(count, "transaction");
}

export function formatBlockCount(count: number): string {
  return formatCount(count, "block");
}

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Can't format a value of ${value}`);
  }

  return valueFormat.format(value);
}

function decimalsOf(value: number): number {
  const [mantissa, exponent] = Math.abs(value).toExponential().split("e");
  const mantissaDecimals = mantissa.replace(".", "").length - 1;

  return Math.max(mantissaDecimals - Number(exponent), 0);
}

export function formatAxisValues(ticks: number[]): string[] {
  const decimals = Math.max(...ticks.map(decimalsOf));
  const axisFormat = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return ticks.map((tick) => axisFormat.format(tick));
}

export function formatMultiplier(multiplier: number): string {
  return multiplierFormat.format(multiplier);
}

export function formatAmount(amount: number): string {
  return amountFormat.format(amount).replace("-", MINUS_SIGN);
}

export function formatLiquidity(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Can't format a liquidity of ${amount}`);
  }

  return liquidityFormat.format(amount);
}

export function formatChange(change: number): string {
  return changeFormat.format(change).replace("-", MINUS_SIGN);
}

function parseTimestamp(isoTimestamp: string): Date {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid timestamp "${isoTimestamp}"`);
  }

  return date;
}

export function formatTimestamp(isoTimestamp: string): string {
  const [day, time] = parseTimestamp(isoTimestamp).toISOString().split("T");

  return `${day} ${time.slice(0, 5)} UTC`;
}

export function shortTransactionId(id: string): string {
  return id.slice(-SHORT_ID_LENGTH);
}

const shortDateFormat = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatShortDate(isoTimestamp: string): string {
  return shortDateFormat.format(parseTimestamp(isoTimestamp));
}

const axisAmountFormat = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumSignificantDigits: 3,
});

export function formatAxisAmount(amount: number): string {
  return axisAmountFormat.format(amount);
}
