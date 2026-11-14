import { createMockApi } from "../mocks/api.js";
import { createHttpApi } from "./http.js";
import type {
  AdminCurrency,
  AdminUser,
  BlockedUser,
  BlockLevel,
  BlockResult,
  Currency,
  CurrencyChanges,
  CurrencyDetails,
  CurrencySettings,
  CurrentUser,
  HistoryDays,
  NewCurrency,
  PendingTransaction,
  ReservePoint,
  ReverseRequest,
  Transaction,
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
  listAllCurrencies(): Promise<Currency[]>;
  getCurrency(abbreviation: string): Promise<Currency>;
  listCurrencyTransactions(currencyId: string): Promise<Transaction[]>;
  getReserveHistory(
    currencyId: string,
    days: HistoryDays,
  ): Promise<ReservePoint[]>;
  listRecentTransactions(): Promise<Transaction[]>;
  getQuote(
    fromCurrencyId: string,
    toCurrencyId: string,
    amount: number,
  ): Promise<number>;

  getMe(): Promise<CurrentUser | null>;
  logout(): Promise<void>;
  listMyTransactions(): Promise<Transaction[]>;

  listOwnedCurrencies(): Promise<Currency[]>;
  getCurrencySettings(currencyId: string): Promise<CurrencySettings>;
  updateCurrencyDetails(
    currencyId: string,
    details: CurrencyDetails,
  ): Promise<Currency>;
  regenerateApiToken(currencyId: string): Promise<string>;
  generateWebhookSecret(currencyId: string): Promise<string>;
  setWebhookUrl(currencyId: string, url: string): Promise<void>;
  removeWebhookUrl(currencyId: string): Promise<void>;
  testWebhook(currencyId: string): Promise<number>;
  setDailyCap(currencyId: string, cap: number): Promise<void>;
  removeDailyCap(currencyId: string): Promise<void>;
  listPendingTransactions(currencyId: string): Promise<PendingTransaction[]>;
  resendWebhook(transactionId: string): Promise<void>;
  currencyBlocks(currencyId: string): BlockListApi;

  listAdminCurrencies(): Promise<AdminCurrency[]>;
  addCurrency(currency: NewCurrency): Promise<AdminCurrency>;
  updateCurrency(
    currencyId: string,
    changes: CurrencyChanges,
  ): Promise<AdminCurrency>;
  globalBlocks: BlockListApi;
  listAdmins(): Promise<AdminUser[]>;
  grantAdmin(userId: string): Promise<AdminUser>;
  removeAdmin(userId: string): Promise<void>;
}

export const LOGIN_PATH = "/api/auth/discord/login";

const API_BUILDERS: Record<string, () => DiscoinApi> = {
  http: createHttpApi,
  mock: createMockApi,
};

function createApi(mode: string): DiscoinApi {
  if (!(mode in API_BUILDERS)) {
    throw new Error(
      `Build with --mode http or --mode mock to pick the API. Got "${mode}".`,
    );
  }

  return API_BUILDERS[mode]();
}

export const api: DiscoinApi = createApi(import.meta.env.VITE_API_MODE);
