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

export interface TransactionRecord {
  id: string;
  fromCurrencyId: string;
  toCurrencyId: string;
  amount: number;
  payout: number;
  status: TransactionStatus;
  submittedAt: string;
  handledAt: string | null;
}

export interface CurrencyLabel {
  abbreviation: string;
  name: string;
  removed: boolean;
}

export interface Transaction extends TransactionRecord {
  fromCurrency: CurrencyLabel;
  toCurrency: CurrencyLabel;
}

export interface PendingTransaction extends Transaction {
  userId: string;
}

export type BlockState = "active" | "lifted" | "merged";

export interface BotLabel {
  name: string;
  removed: boolean;
}

export interface NoBlockCause {
  kind: "none";
}

export interface SiteWideBlockCause {
  kind: "global";
  state: BlockState;
  reason?: string;
}

export interface BotBlockCause {
  kind: "bot";
  bot: BotLabel;
  state: BlockState;
  reason?: string;
}

export type TransactionCause =
  | NoBlockCause
  | SiteWideBlockCause
  | BotBlockCause;

export interface TransactionDetail extends Transaction {
  userId?: string;
  cause?: TransactionCause;
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
  multiplier: number;
  botId: string | null;
}

export interface BotWithCurrencies {
  id: string;
  name: string;
  currencies: Currency[];
}

export interface BotSettings {
  hasApiToken: boolean;
  hasWebhookSecret: boolean;
  webhookUrl: string | null;
}

export interface CurrencySettings {
  dailyCap: number | null;
}

export interface BotName {
  id: string;
  name: string;
}

export interface AdminCurrency {
  currency: Currency;
  weeklyMedian: number;
  multiplier: number;
  bot: BotName | null;
}

export interface SavedCurrency {
  saved: AdminCurrency;
  movedBlocks: number;
}

export interface BotDetails {
  name: string;
  discordId: string;
  ownerId: string;
}

export interface AdminBot extends BotDetails {
  id: string;
  currencyCount: number;
}

export type BotChanges = Partial<BotDetails>;

export interface CurrencyName {
  id: string;
  abbreviation: string;
  name: string;
}

export interface RemovalPreview {
  currencies: CurrencyName[];
  pendingTransactions: number;
  enforcedBlocks: number;
}

export type BlockLevel = "bot" | "global";

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
  defaultAvatarUrl: string;
  isAdmin: boolean;
  ownedBots: OwnedBot[];
}

export interface OwnedBot {
  id: string;
  name: string;
  currencyIds: string[];
}

export const HISTORY_DAYS = [7, 30] as const;

export type HistoryDays = (typeof HISTORY_DAYS)[number];

export interface CurrencyChanges {
  botId?: string;
  weeklyMedian?: number;
  multiplier?: number;
  active?: boolean;
}
