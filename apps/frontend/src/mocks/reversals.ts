import { ApiError } from "../api/errors.js";
import type {
  ReverseDirection,
  ReverseRequest,
  ReverseWindow,
  Transaction,
} from "../api/types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const WINDOW_MS: Record<ReverseWindow, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  all: Number.POSITIVE_INFINITY,
};

export type TransactionFilter = (transaction: Transaction) => boolean;

const DIRECTION_FILTERS: Record<
  ReverseDirection,
  (currencyId: string) => TransactionFilter
> = {
  incoming: (currencyId) => (transaction) =>
    transaction.toCurrencyId === currencyId,
  outgoing: (currencyId) => (transaction) =>
    transaction.fromCurrencyId === currencyId,
  both: (currencyId) => (transaction) =>
    transaction.toCurrencyId === currencyId ||
    transaction.fromCurrencyId === currencyId,
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
  currencyId: string,
  reverse: ReverseRequest,
): TransactionFilter {
  if (reverse.direction === undefined) {
    throw new ApiError(400, "Pick which direction to reverse.", "direction");
  }

  return DIRECTION_FILTERS[reverse.direction](currencyId);
}

export interface ReversalCriteria {
  senders: Record<string, string>;
  userId: string;
  window: ReverseWindow;
  involves: TransactionFilter;
}

function submittedAt(transaction: Transaction): number {
  return Date.parse(transaction.submittedAt);
}

function senderOf(senders: Record<string, string>, id: string): string {
  if (!(id in senders)) throw new Error(`Transaction ${id} has no sender`);

  return senders[id];
}

export function selectReversible(
  transactions: Transaction[],
  criteria: ReversalCriteria,
): Transaction[] {
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
