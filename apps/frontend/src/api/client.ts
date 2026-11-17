import { createHttpApi } from "./http.js";
import type {
  AdminBot,
  AdminCurrency,
  AdminUser,
  BlockedUser,
  BlockLevel,
  BlockResult,
  BotChanges,
  BotDetails,
  BotSettings,
  BotWithCurrencies,
  Currency,
  CurrencyChanges,
  CurrencyDetails,
  CurrencySettings,
  CurrentUser,
  HistoryDays,
  NewCurrency,
  PendingTransaction,
  RemovalPreview,
  ReservePoint,
  ReverseRequest,
  SavedCurrency,
  Transaction,
  TransactionDetail,
} from "./types.js";

export interface BlockListApi {
  level: BlockLevel;
  list(): Promise<BlockedUser[]>;
  block(
    userId: string,
    reason: string,
    reverse?: ReverseRequest,
  ): Promise<BlockResult>;
  previewBlock(
    userId: string,
    reason: string,
    reverse: ReverseRequest,
  ): Promise<Transaction[]>;
  unblock(userId: string): Promise<void>;
}

export interface DiscoinApi {
  listCurrencies(): Promise<Currency[]>;
  getCurrency(abbreviation: string): Promise<Currency>;
  listCurrencyTransactions(currencyId: string): Promise<Transaction[]>;
  getReserveHistory(
    currencyId: string,
    days: HistoryDays,
  ): Promise<ReservePoint[]>;
  listRecentTransactions(): Promise<Transaction[]>;
  getTransaction(transactionId: string): Promise<TransactionDetail>;
  getQuote(
    fromCurrencyId: string,
    toCurrencyId: string,
    amount: number,
  ): Promise<number>;

  getMe(): Promise<CurrentUser | null>;
  logout(): Promise<void>;
  listMyTransactions(): Promise<Transaction[]>;

  listOwnedBots(): Promise<BotWithCurrencies[]>;
  getBotSettings(botId: string): Promise<BotSettings>;
  getCurrencySettings(currencyId: string): Promise<CurrencySettings>;
  updateCurrencyDetails(
    currencyId: string,
    details: CurrencyDetails,
  ): Promise<Currency>;
  regenerateApiToken(botId: string): Promise<string>;
  generateWebhookSecret(botId: string): Promise<string>;
  setWebhookUrl(botId: string, url: string): Promise<void>;
  removeWebhookUrl(botId: string): Promise<void>;
  testWebhook(botId: string): Promise<number>;
  setDailyCap(currencyId: string, cap: number): Promise<void>;
  removeDailyCap(currencyId: string): Promise<void>;
  listPendingTransactions(botId: string): Promise<PendingTransaction[]>;
  resendWebhook(transactionId: string): Promise<void>;
  botBlocks(botId: string): BlockListApi;

  listAdminCurrencies(): Promise<AdminCurrency[]>;
  addCurrency(currency: NewCurrency): Promise<AdminCurrency>;
  updateCurrency(
    currencyId: string,
    changes: CurrencyChanges,
  ): Promise<SavedCurrency>;
  previewCurrencyRemoval(currencyId: string): Promise<RemovalPreview>;
  removeCurrency(currencyId: string): Promise<void>;
  listAdminBots(): Promise<AdminBot[]>;
  addBot(bot: BotDetails): Promise<AdminBot>;
  updateBot(botId: string, changes: BotChanges): Promise<AdminBot>;
  previewBotRemoval(botId: string): Promise<RemovalPreview>;
  removeBot(botId: string): Promise<void>;
  globalBlocks: BlockListApi;
  listAdmins(): Promise<AdminUser[]>;
  grantAdmin(userId: string): Promise<AdminUser>;
  removeAdmin(userId: string): Promise<void>;
}

export const LOGIN_PATH = "/api/auth/discord/login";

async function createApi(): Promise<DiscoinApi> {
  if (import.meta.env.VITE_API_MODE === "http") return createHttpApi();

  if (import.meta.env.VITE_API_MODE === "mock") {
    const { createMockApi } = await import("../mocks/api.js");

    return createMockApi();
  }

  throw new Error(
    `Build with --mode http or --mode mock to pick the API. Got "${import.meta.env.VITE_API_MODE}".`,
  );
}

export const api: DiscoinApi = await createApi();
