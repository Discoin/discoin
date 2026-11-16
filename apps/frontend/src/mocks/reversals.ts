import { ApiError } from "../api/errors.js";
import type {
  ReverseDirection,
  ReverseRequest,
  ReverseWindow,
  TransactionRecord,
} from "../api/types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const WINDOW_MS: Record<ReverseWindow, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  all: Number.POSITIVE_INFINITY,
};

export type TransactionFilter = (transaction: TransactionRecord) => boolean;

const DIRECTION_FILTERS: Record<
  ReverseDirection,
  (botCurrencyIds: string[]) => TransactionFilter
> = {
  incoming: (botCurrencyIds) => (transaction) =>
    botCurrencyIds.includes(transaction.toCurrencyId),
  outgoing: (botCurrencyIds) => (transaction) =>
    botCurrencyIds.includes(transaction.fromCurrencyId),
  both: (botCurrencyIds) => (transaction) =>
    botCurrencyIds.includes(transaction.toCurrencyId) ||
    botCurrencyIds.includes(transaction.fromCurrencyId),
};

export function adminReversalFilter(
  reverse: ReverseRequest,
): TransactionFilter {
  if (reverse.direction !== undefined) {
    throw new ApiError(
      400,
      "An admin block reverses every direction, so it takes no direction.",
      "direction",
    );
  }

  return () => true;
}

export function ownerReversalFilter(
  botCurrencyIds: string[],
  reverse: ReverseRequest,
): TransactionFilter {
  if (reverse.direction === undefined) {
    throw new ApiError(400, "Pick which direction to reverse.", "direction");
  }

  return DIRECTION_FILTERS[reverse.direction](botCurrencyIds);
}

export interface ReversalCriteria {
  senders: Record<string, string>;
  userId: string;
  window: ReverseWindow;
  involves: TransactionFilter;
}

function submittedAt(transaction: TransactionRecord): number {
  return Date.parse(transaction.submittedAt);
}

function senderOf(senders: Record<string, string>, id: string): string {
  if (!(id in senders)) throw new Error(`Transaction ${id} has no sender`);

  return senders[id];
}

export function selectReversible(
  transactions: TransactionRecord[],
  criteria: ReversalCriteria,
): TransactionRecord[] {
  const since = Date.now() - WINDOW_MS[criteria.window];

  return transactions
    .filter(
      (transaction) =>
        transaction.status === "Completed" &&
        senderOf(criteria.senders, transaction.id) === criteria.userId &&
        submittedAt(transaction) >= since &&
        criteria.involves(transaction),
    )
    .sort((a, b) => submittedAt(b) - submittedAt(a));
}
