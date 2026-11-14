import type { BlockListApi, DiscoinApi } from "./client.js";
import { ApiError, DailyCapError } from "./errors.js";
import type {
  AdminCurrency,
  AdminUser,
  BlockedUser,
  BlockLevel,
  BlockResult,
  Currency,
  CurrencySettings,
  CurrentUser,
  PendingTransaction,
  ReservePoint,
  ReverseRequest,
  Transaction,
} from "./types.js";

export const API_BASE = "/api";

const UNAUTHORIZED = 401;
const NO_CONTENT = 204;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ErrorBody {
  status: number;
  message: string;
  field: string | null;
  maxAmount?: number;
}

function isErrorBody(body: unknown): body is ErrorBody {
  if (typeof body !== "object" || body === null) return false;

  const candidate = body as Record<string, unknown>;

  return (
    typeof candidate.status === "number" &&
    typeof candidate.message === "string" &&
    (candidate.field === null || typeof candidate.field === "string")
  );
}

function toApiError(body: ErrorBody): ApiError {
  const field = body.field ?? undefined;
  if (body.maxAmount !== undefined && field !== undefined) {
    return new DailyCapError(body.message, field, body.maxAmount);
  }

  return new ApiError(body.status, body.message, field);
}

async function readError(response: Response): Promise<Error> {
  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const body: unknown = isJson ? await response.json() : undefined;
  if (isErrorBody(body)) return toApiError(body);

  return new Error(
    `The Discoin API answered ${response.status} ${response.statusText} without an error body.`,
  );
}

async function send(
  method: Method,
  path: string,
  body?: unknown,
): Promise<Response> {
  const response = await fetch(API_BASE + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await readError(response);

  return response;
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await send(method, path, body);

  return (await response.json()) as T;
}

async function command(
  method: Method,
  path: string,
  body?: unknown,
): Promise<void> {
  const response = await send(method, path, body);
  if (response.status !== NO_CONTENT) {
    throw new Error(
      `Expected no content from ${method} ${path}, got ${response.status}.`,
    );
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function blockBody(userId: string, reason: string, reverse?: ReverseRequest) {
  return reverse === undefined
    ? { userId, reason }
    : { userId, reason, reverse };
}

function createBlockList(level: BlockLevel, base: string): BlockListApi {
  return {
    level,
    list: () => request<BlockedUser[]>("GET", base),
    block: (userId, reason, reverse) =>
      request<BlockResult>("POST", base, blockBody(userId, reason, reverse)),
    previewBlock: (userId, reason, reverse) =>
      request<Transaction[]>(
        "POST",
        `${base}/preview`,
        blockBody(userId, reason, reverse),
      ),
    unblock: (userId) => command("DELETE", `${base}/${segment(userId)}`),
  };
}

async function getMe(): Promise<CurrentUser | null> {
  const response = await fetch(`${API_BASE}/me`, {
    credentials: "same-origin",
  });
  if (response.status === UNAUTHORIZED) return null;

  if (!response.ok) throw await readError(response);

  return (await response.json()) as CurrentUser;
}

export function createHttpApi(): DiscoinApi {
  return {
    listCurrencies: () => request<Currency[]>("GET", "/currencies"),
    listAllCurrencies: () =>
      request<Currency[]>("GET", "/currencies?includeInactive=true"),
    getCurrency: (abbreviation) =>
      request<Currency>("GET", `/currencies/${segment(abbreviation)}`),
    listCurrencyTransactions: (currencyId) =>
      request<Transaction[]>(
        "GET",
        `/currencies/${segment(currencyId)}/transactions`,
      ),
    getReserveHistory: (currencyId, days) =>
      request<ReservePoint[]>(
        "GET",
        `/currencies/${segment(currencyId)}/history?days=${days}`,
      ),
    listRecentTransactions: () =>
      request<Transaction[]>("GET", "/transactions"),
    getQuote: async (fromCurrencyId, toCurrencyId, amount) => {
      const query = new URLSearchParams({
        fromCurrencyId,
        toCurrencyId,
        amount: String(amount),
      });
      const quote = await request<{ payout: number }>(
        "GET",
        `/quote?${query.toString()}`,
      );

      return quote.payout;
    },

    getMe,
    logout: () => command("POST", "/auth/logout"),
    listMyTransactions: () => request<Transaction[]>("GET", "/me/transactions"),

    listOwnedCurrencies: () => request<Currency[]>("GET", "/owner/currencies"),
    getCurrencySettings: (currencyId) =>
      request<CurrencySettings>(
        "GET",
        `/currencies/${segment(currencyId)}/settings`,
      ),
    updateCurrencyDetails: (currencyId, details) =>
      request<Currency>("PATCH", `/currencies/${segment(currencyId)}`, details),
    regenerateApiToken: async (currencyId) => {
      const issued = await request<{ token: string }>(
        "POST",
        `/currencies/${segment(currencyId)}/api-token`,
      );

      return issued.token;
    },
    generateWebhookSecret: async (currencyId) => {
      const issued = await request<{ secret: string }>(
        "POST",
        `/currencies/${segment(currencyId)}/webhook-secret`,
      );

      return issued.secret;
    },
    setWebhookUrl: (currencyId, url) =>
      command("PUT", `/currencies/${segment(currencyId)}/webhook-url`, {
        webhookUrl: url,
      }),
    removeWebhookUrl: (currencyId) =>
      command("DELETE", `/currencies/${segment(currencyId)}/webhook-url`),
    testWebhook: async (currencyId) => {
      const result = await request<{ status: number }>(
        "POST",
        `/currencies/${segment(currencyId)}/webhook-test`,
      );

      return result.status;
    },
    setDailyCap: (currencyId, cap) =>
      command("PUT", `/currencies/${segment(currencyId)}/daily-cap`, {
        dailyCap: cap,
      }),
    removeDailyCap: (currencyId) =>
      command("DELETE", `/currencies/${segment(currencyId)}/daily-cap`),
    listPendingTransactions: (currencyId) =>
      request<PendingTransaction[]>(
        "GET",
        `/currencies/${segment(currencyId)}/transactions/pending`,
      ),
    resendWebhook: (transactionId) =>
      command("POST", `/transactions/${segment(transactionId)}/resend-webhook`),
    currencyBlocks: (currencyId) =>
      createBlockList("currency", `/currencies/${segment(currencyId)}/blocks`),

    listAdminCurrencies: () =>
      request<AdminCurrency[]>("GET", "/admin/currencies"),
    addCurrency: (currency) =>
      request<AdminCurrency>("POST", "/admin/currencies", currency),
    updateCurrency: (currencyId, changes) =>
      request<AdminCurrency>(
        "PATCH",
        `/admin/currencies/${segment(currencyId)}`,
        changes,
      ),
    globalBlocks: createBlockList("global", "/admin/blocks"),
    listAdmins: () => request<AdminUser[]>("GET", "/admin/admins"),
    grantAdmin: (userId) =>
      request<AdminUser>("POST", "/admin/admins", { userId }),
    removeAdmin: (userId) =>
      command("DELETE", `/admin/admins/${segment(userId)}`),
  };
}
