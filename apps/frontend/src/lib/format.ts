const LOCALE = "en-US";
const MINUS_SIGN = "−";
const SHORT_ID_LENGTH = 6;

const valueFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
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

export function formatTransactionCount(count: number): string {
  const noun = count === 1 ? "transaction" : "transactions";

  return `${countFormat.format(count)} ${noun}`;
}

export function formatValue(value: number): string {
  return valueFormat.format(value);
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
