export const TRANSACTION_STATUSES = [
  "Pending",
  "Completed",
  "Cancelled",
  "Refunded",
  "Reversed",
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export interface Currency {
  id: string;
  abbreviation: string;
  name: string;
  reserve: number;
  active: boolean;
  change24h: number;
  valueHistory: number[];
}

export interface Transaction {
  id: string;
  fromCurrencyId: string;
  toCurrencyId: string;
  amount: number;
  payout: number;
  status: TransactionStatus;
  submittedAt: string;
  handledAt: string | null;
}

export interface PendingTransaction extends Transaction {
  userId: string;
}

export interface ReservePoint {
  at: string;
  reserve: number;
}

export interface CurrencyDetails {
  name: string;
  abbreviation: string;
}

export interface NewCurrency extends CurrencyDetails {
  weeklyMedian: number;
  ownerId: string;
}

export interface CurrencySettings {
  hasApiToken: boolean;
  hasWebhookSecret: boolean;
  webhookUrl: string | null;
  dailyCap: number | null;
}

export interface AdminCurrency {
  currency: Currency;
  weeklyMedian: number;
  ownerId: string;
}

export type BlockLevel = "currency" | "global";

export interface BlockedUser {
  userId: string;
  reason: string;
  blockedAt: string;
  level: BlockLevel;
}

export type ReverseWindow = "24h" | "7d" | "30d" | "all";

export type ReverseDirection = "incoming" | "outgoing" | "both";

export interface ReverseRequest {
  window: ReverseWindow;
  direction?: ReverseDirection;
}

export interface BlockResult {
  blocked: BlockedUser;
  reversed: Transaction[];
}

export interface AdminUser {
  userId: string;
  username: string | null;
}

export interface CurrentUser {
  userId: string;
  username: string | null;
  avatarUrl: string;
  isAdmin: boolean;
  ownedCurrencyIds: string[];
}

export const HISTORY_DAYS = [7, 30] as const;

export type HistoryDays = (typeof HISTORY_DAYS)[number];

export interface CurrencyChanges {
  ownerId?: string;
  weeklyMedian?: number;
  active?: boolean;
}
