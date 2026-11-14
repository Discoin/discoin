import type { BlockListApi, DiscoinApi } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type {
  AdminCurrency,
  AdminUser,
  BlockedUser,
  BlockLevel,
  Currency,
  CurrencyChanges,
  CurrencyDetails,
  CurrencySettings,
  CurrentUser,
  NewCurrency,
  PendingTransaction,
  ReservePoint,
  ReverseRequest,
  Transaction,
  TransactionStatus,
} from "../api/types.js";
import { MAX_SEND_AMOUNT } from "../lib/converter.js";
import {
  calculatePayout,
  currencyValue,
  reservesAfterUndo,
  startingReserve,
} from "../lib/exchange.js";
import { formatAmount } from "../lib/format.js";
import {
  sampleAdmins,
  sampleCurrencies,
  sampleCurrencyBlocks,
  sampleCurrentUser,
  sampleGlobalBlocks,
  sampleOwnerIds,
  sampleReserveHistories,
  sampleSettings,
  sampleTransactionSenders,
  sampleTransactions,
  sampleWeeklyMedians,
} from "./data.js";
import {
  adminReversalFilter,
  ownerReversalFilter,
  selectReversible,
  type TransactionFilter,
} from "./reversals.js";

const LATENCY_MS = 300;
const DAY_MS = 86_400_000;
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const ABBREVIATION_PATTERN = /^[A-Z]{3,4}$/;
const SECRET_PREFIX = "whsec_";
const MOCK_WEBHOOK_STATUS = 200;
const SAMPLE_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#5865f2"/><text x="32" y="42" font-family="sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">C</text></svg>',
  );
const TOKEN_PREFIX = "dsc_live_";
const TOKEN_LENGTH = 24;
const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

interface MockState {
  currencies: Currency[];
  histories: Record<string, ReservePoint[]>;
  weeklyMedians: Record<string, number>;
  ownerIds: Record<string, string>;
  transactions: Transaction[];
  transactionSenders: Record<string, string>;
  settings: Record<string, CurrencySettings>;
  currencyBlocks: Record<string, BlockedUser[]>;
  globalBlocks: BlockedUser[];
  admins: AdminUser[];
  loggedIn: boolean;
}

function initialState(): MockState {
  return structuredClone({
    currencies: sampleCurrencies,
    histories: sampleReserveHistories,
    weeklyMedians: sampleWeeklyMedians,
    ownerIds: sampleOwnerIds,
    transactions: sampleTransactions,
    transactionSenders: sampleTransactionSenders,
    settings: sampleSettings,
    currencyBlocks: sampleCurrencyBlocks,
    globalBlocks: sampleGlobalBlocks,
    admins: sampleAdmins,
    loggedIn: true,
  });
}

function respond<T>(produce: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(structuredClone(produce()));
      } catch (error) {
        reject(error);
      }
    }, LATENCY_MS);
  });
}

function notFound(what: string): ApiError {
  return new ApiError(404, `No ${what} with that ID.`);
}

function lookup<T>(record: Record<string, T>, key: string, what: string): T {
  if (!(key in record)) throw notFound(what);

  return record[key];
}

function requiredText(value: string, field: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new ApiError(400, `Enter a ${label}.`, field);

  return trimmed;
}

function positiveAmount(value: number, field: string, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ApiError(400, `The ${label} must be above 0.`, field);
  }

  if (value > MAX_SEND_AMOUNT) {
    throw new ApiError(
      400,
      `The ${label} can be at most ${formatAmount(MAX_SEND_AMOUNT)}.`,
      field,
    );
  }

  return value;
}

function discordUserId(value: string, field: string): string {
  const trimmed = value.trim();
  if (!DISCORD_ID_PATTERN.test(trimmed)) {
    throw new ApiError(
      400,
      "Enter a Discord user ID: 17 to 20 digits, like 412358906715234305.",
      field,
    );
  }

  return trimmed;
}

function checkedOwner(changes: CurrencyChanges): string | undefined {
  if (changes.ownerId === undefined) return undefined;

  return discordUserId(changes.ownerId, "ownerId");
}

function checkedMedian(changes: CurrencyChanges): number | undefined {
  if (changes.weeklyMedian === undefined) return undefined;

  return positiveAmount(changes.weeklyMedian, "weeklyMedian", "weekly median");
}

function webhookUrl(value: string): string {
  const trimmed = value.trim();
  if (!URL.canParse(trimmed) || new URL(trimmed).protocol !== "https:") {
    throw new ApiError(
      400,
      "Enter a full https:// URL, like https://bot.example.com/discoin.",
      "webhookUrl",
    );
  }

  return trimmed;
}

function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  const characters = Array.from(
    bytes,
    (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length],
  );

  return prefix + characters.join("");
}

function checkedAbbreviation(value: string): string {
  const abbreviation = requiredText(
    value,
    "abbreviation",
    "abbreviation",
  ).toUpperCase();
  if (!ABBREVIATION_PATTERN.test(abbreviation)) {
    throw new ApiError(
      400,
      "Use 3 or 4 letters, A to Z, for the abbreviation.",
      "abbreviation",
    );
  }

  return abbreviation;
}

function isListed(users: BlockedUser[], userId: string): boolean {
  return users.some((user) => user.userId === userId);
}

interface BlockStore {
  level: BlockLevel;
  read: () => BlockedUser[];
  write: (users: BlockedUser[]) => void;
  readInherited: () => BlockedUser[];
  findReversible: (userId: string, reverse: ReverseRequest) => Transaction[];
  findCancellable: (userId: string) => Transaction[];
  undo: (
    transactions: Transaction[],
    status: TransactionStatus,
  ) => Transaction[];
}

interface BlockPlan {
  blocked: BlockedUser;
  toReverse: Transaction[];
}

function createBlockList(store: BlockStore): BlockListApi {
  const { level, read, write, readInherited, findReversible } = store;

  function plan(
    userId: string,
    reason: string,
    reverse: ReverseRequest | undefined,
  ): BlockPlan {
    const id = discordUserId(userId, "userId");
    const checkedReason = requiredText(reason, "reason", "reason");

    if (isListed(read(), id)) {
      throw new ApiError(409, "That user is already blocked.", "userId");
    }

    const blocked = {
      userId: id,
      reason: checkedReason,
      blockedAt: new Date().toISOString(),
      level,
    };
    const toReverse = reverse === undefined ? [] : findReversible(id, reverse);

    return { blocked, toReverse };
  }

  return {
    level,
    list: () => respond(() => [...read(), ...readInherited()]),
    block: (userId, reason, reverse) =>
      respond(() => {
        const { blocked, toReverse } = plan(userId, reason, reverse);
        const reversed = store.undo(toReverse, "Reversed");
        store.undo(store.findCancellable(blocked.userId), "Cancelled");
        write([blocked, ...read()]);

        return { blocked, reversed };
      }),
    previewBlock: (userId, reason, reverse) =>
      respond(() => plan(userId, reason, reverse).toReverse),
    unblock: (userId) =>
      respond(() => {
        if (!isListed(read(), userId)) throw notFound("blocked user");

        write(read().filter((user) => user.userId !== userId));
      }),
  };
}

export function createMockApi(): DiscoinApi {
  const state = initialState();

  function currency(id: string): Currency {
    const found = state.currencies.find((candidate) => candidate.id === id);
    if (found === undefined) throw notFound("currency");

    return found;
  }

  function replaceCurrency(updated: Currency): void {
    state.currencies = state.currencies.map((candidate) =>
      candidate.id === updated.id ? updated : candidate,
    );
  }

  function isMine(currencyId: string): boolean {
    return (
      lookup(state.ownerIds, currencyId, "currency owner") ===
      sampleCurrentUser.userId
    );
  }

  function ownedCurrency(id: string): Currency {
    if (!isMine(id)) {
      throw new ApiError(403, "You don't own that currency.");
    }

    return currency(id);
  }

  function settings(currencyId: string): CurrencySettings {
    ownedCurrency(currencyId);

    return lookup(state.settings, currencyId, "currency settings");
  }

  function checkedDetails(
    details: CurrencyDetails,
    others: Currency[],
  ): CurrencyDetails {
    const name = requiredText(details.name, "name", "name");
    const abbreviation = checkedAbbreviation(details.abbreviation);
    const taken = others.some(
      (candidate) => candidate.abbreviation === abbreviation,
    );
    if (taken) {
      throw new ApiError(
        409,
        `${abbreviation} is taken by another currency. Pick a different abbreviation.`,
        "abbreviation",
      );
    }

    return { name, abbreviation };
  }

  function adminCurrency(found: Currency): AdminCurrency {
    return {
      currency: found,
      weeklyMedian: lookup(state.weeklyMedians, found.id, "weekly median"),
      ownerId: lookup(state.ownerIds, found.id, "currency owner"),
    };
  }

  function withReserve(found: Currency, reserve: number): Currency {
    const valueHistory = [
      ...found.valueHistory.slice(0, -1),
      currencyValue(reserve),
    ];

    return { ...found, reserve, valueHistory };
  }

  function setReserve(currencyId: string, reserve: number): void {
    replaceCurrency(withReserve(currency(currencyId), reserve));
    state.histories[currencyId] = [
      ...lookup(state.histories, currencyId, "currency"),
      { at: new Date().toISOString(), reserve },
    ];
  }

  function resetReserve(found: Currency, weeklyMedian: number): void {
    setReserve(found.id, startingReserve(weeklyMedian));
    state.weeklyMedians[found.id] = weeklyMedian;
  }

  function atomically<T>(change: () => T): T {
    const snapshot = structuredClone(state);
    try {
      return change();
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    }
  }

  function undoOne(
    transaction: Transaction,
    status: TransactionStatus,
  ): Transaction {
    const { fromCurrencyId, toCurrencyId } = transaction;
    const reserves = reservesAfterUndo(transaction.payout, {
      from: currency(fromCurrencyId).reserve,
      to: currency(toCurrencyId).reserve,
    });
    setReserve(fromCurrencyId, reserves.from);
    setReserve(toCurrencyId, reserves.to);

    const undone = {
      ...transaction,
      status,
      handledAt: new Date().toISOString(),
    };
    state.transactions = state.transactions.map((candidate) =>
      candidate.id === undone.id ? undone : candidate,
    );

    return undone;
  }

  function undoAll(
    transactions: Transaction[],
    status: TransactionStatus,
  ): Transaction[] {
    return atomically(() =>
      transactions.map((transaction) => undoOne(transaction, status)),
    );
  }

  function senderOf(transaction: Transaction): string {
    return lookup(state.transactionSenders, transaction.id, "transaction");
  }

  function involvesCurrency(currencyId: string): TransactionFilter {
    return (transaction) =>
      transaction.fromCurrencyId === currencyId ||
      transaction.toCurrencyId === currencyId;
  }

  function pendingOf(userId: string, involves: TransactionFilter) {
    return state.transactions
      .filter(
        (transaction) =>
          transaction.status === "Pending" &&
          senderOf(transaction) === userId &&
          involves(transaction),
      )
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  }

  function requireActive(found: Currency, field: string): void {
    if (found.active) return;

    throw new ApiError(
      400,
      `${found.abbreviation} is inactive, so it can't be converted right now.`,
      field,
    );
  }

  function quote(
    fromCurrencyId: string,
    toCurrencyId: string,
    amount: number,
  ): number {
    positiveAmount(amount, "amount", "amount");
    const from = currency(fromCurrencyId);
    const to = currency(toCurrencyId);
    if (from.id === to.id) {
      throw new ApiError(
        400,
        "Pick a different currency to convert into.",
        "toCurrencyId",
      );
    }

    requireActive(from, "fromCurrencyId");
    requireActive(to, "toCurrencyId");
    const payout = calculatePayout(amount, {
      from: from.reserve,
      to: to.reserve,
    });
    if (payout === 0) {
      throw new ApiError(
        400,
        "This amount is too small to convert. Send more.",
        "amount",
      );
    }

    return payout;
  }

  function currentUser(): CurrentUser | null {
    if (!state.loggedIn) return null;

    const { userId, username } = sampleCurrentUser;
    const ownedCurrencyIds = state.currencies
      .filter((found) => isMine(found.id))
      .map((found) => found.id);

    return {
      userId,
      username,
      avatarUrl: SAMPLE_AVATAR,
      isAdmin: true,
      ownedCurrencyIds,
    };
  }

  function cancelPendingFor(currencyId: string): void {
    const pending = state.transactions.filter(
      (transaction) =>
        transaction.status === "Pending" &&
        involvesCurrency(currencyId)(transaction),
    );
    undoAll(pending, "Cancelled");
  }

  function setActive(currencyId: string, active: boolean): void {
    if (currency(currencyId).active === active) return;

    if (!active) cancelPendingFor(currencyId);
    replaceCurrency({ ...currency(currencyId), active });
  }

  function reversibleBy(
    userId: string,
    reverse: ReverseRequest,
    involves: TransactionFilter,
  ): Transaction[] {
    return selectReversible(state.transactions, {
      senders: state.transactionSenders,
      userId,
      window: reverse.window,
      involves,
    });
  }

  return {
    listCurrencies: () =>
      respond(() => state.currencies.filter((found) => found.active)),
    listAllCurrencies: () => respond(() => state.currencies),
    getCurrency: (abbreviation) =>
      respond(() => {
        const wanted = abbreviation.toUpperCase();
        const found = state.currencies.find(
          (candidate) => candidate.abbreviation === wanted,
        );
        if (found === undefined) {
          throw new ApiError(404, `No currency called ${wanted}.`);
        }

        return found;
      }),
    listCurrencyTransactions: (currencyId) =>
      respond(() =>
        state.transactions.filter(
          (transaction) =>
            transaction.fromCurrencyId === currencyId ||
            transaction.toCurrencyId === currencyId,
        ),
      ),
    getReserveHistory: (currencyId, days) =>
      respond(() => {
        const points = lookup(state.histories, currencyId, "currency");
        const latest = Date.parse(points[points.length - 1].at);
        const since = latest - days * DAY_MS;

        return points.filter((point) => Date.parse(point.at) >= since);
      }),
    getQuote: (fromCurrencyId, toCurrencyId, amount) =>
      respond(() => quote(fromCurrencyId, toCurrencyId, amount)),
    getMe: () => respond(currentUser),
    logout: () =>
      respond(() => {
        state.loggedIn = false;
      }),
    listRecentTransactions: () => respond(() => state.transactions),
    listMyTransactions: () =>
      respond(() =>
        state.transactions.filter(
          (transaction) => senderOf(transaction) === sampleCurrentUser.userId,
        ),
      ),

    listOwnedCurrencies: () =>
      respond(() => state.currencies.filter((found) => isMine(found.id))),
    getCurrencySettings: (currencyId) => respond(() => settings(currencyId)),
    updateCurrencyDetails: (currencyId, details) =>
      respond(() => {
        const updated = {
          ...ownedCurrency(currencyId),
          ...checkedDetails(
            details,
            state.currencies.filter((candidate) => candidate.id !== currencyId),
          ),
        };
        replaceCurrency(updated);

        return updated;
      }),
    regenerateApiToken: (currencyId) =>
      respond(() => {
        settings(currencyId).hasApiToken = true;

        return randomToken(TOKEN_PREFIX);
      }),
    generateWebhookSecret: (currencyId) =>
      respond(() => {
        settings(currencyId).hasWebhookSecret = true;

        return randomToken(SECRET_PREFIX);
      }),
    setWebhookUrl: (currencyId, url) =>
      respond(() => {
        const target = settings(currencyId);
        const checked = webhookUrl(url);
        if (!target.hasWebhookSecret) {
          throw new ApiError(
            400,
            "Generate a webhook secret first, so Discoin can sign each webhook.",
            "webhookUrl",
          );
        }

        target.webhookUrl = checked;
      }),
    testWebhook: (currencyId) =>
      respond(() => {
        if (settings(currencyId).webhookUrl === null) {
          throw new ApiError(
            400,
            "Save a webhook URL before sending a test.",
            "webhookUrl",
          );
        }

        return MOCK_WEBHOOK_STATUS;
      }),
    removeWebhookUrl: (currencyId) =>
      respond(() => {
        settings(currencyId).webhookUrl = null;
      }),
    setDailyCap: (currencyId, cap) =>
      respond(() => {
        settings(currencyId).dailyCap = positiveAmount(
          cap,
          "dailyCap",
          "daily cap",
        );
      }),
    removeDailyCap: (currencyId) =>
      respond(() => {
        settings(currencyId).dailyCap = null;
      }),
    listPendingTransactions: (currencyId) =>
      respond(() => {
        ownedCurrency(currencyId);

        return state.transactions
          .filter(
            (transaction) =>
              transaction.toCurrencyId === currencyId &&
              transaction.status === "Pending",
          )
          .map(
            (transaction): PendingTransaction => ({
              ...transaction,
              userId: senderOf(transaction),
            }),
          );
      }),
    resendWebhook: (transactionId) =>
      respond(() => {
        const transaction = state.transactions.find(
          (candidate) => candidate.id === transactionId,
        );
        if (transaction === undefined) throw notFound("transaction");

        if (transaction.status !== "Pending") {
          throw new ApiError(400, "Only Pending transactions can be resent.");
        }

        const target = settings(transaction.toCurrencyId);
        if (target.webhookUrl === null) {
          throw new ApiError(
            400,
            "Add a webhook URL before resending. Your bot can still poll for this transaction.",
          );
        }
      }),
    currencyBlocks: (currencyId) =>
      createBlockList({
        level: "currency",
        read: () => {
          ownedCurrency(currencyId);

          return lookup(state.currencyBlocks, currencyId, "currency");
        },
        write: (users) => {
          state.currencyBlocks[currencyId] = users;
        },
        readInherited: () => state.globalBlocks,
        findReversible: (userId, reverse) =>
          reversibleBy(
            userId,
            reverse,
            ownerReversalFilter(currencyId, reverse),
          ),
        findCancellable: (userId) =>
          pendingOf(userId, involvesCurrency(currencyId)),
        undo: undoAll,
      }),

    listAdminCurrencies: () =>
      respond(() => state.currencies.map(adminCurrency)),
    addCurrency: (newCurrency) =>
      respond(() => {
        const details = checkedDetails(newCurrency, state.currencies);
        const weeklyMedian = positiveAmount(
          newCurrency.weeklyMedian,
          "weeklyMedian",
          "weekly median",
        );
        const ownerId = discordUserId(newCurrency.ownerId, "ownerId");
        const reserve = startingReserve(weeklyMedian);
        const now = Date.now();
        const added: Currency = {
          id: crypto.randomUUID(),
          ...details,
          reserve,
          active: true,
          change24h: 0,
          valueHistory: [currencyValue(reserve), currencyValue(reserve)],
        };
        state.currencies = [...state.currencies, added];
        state.weeklyMedians[added.id] = weeklyMedian;
        state.ownerIds[added.id] = ownerId;
        state.settings[added.id] = {
          hasApiToken: false,
          hasWebhookSecret: false,
          webhookUrl: null,
          dailyCap: null,
        };
        state.currencyBlocks[added.id] = [];
        state.histories[added.id] = [now - DAY_MS, now].map((at) => ({
          at: new Date(at).toISOString(),
          reserve,
        }));

        return adminCurrency(added);
      }),
    updateCurrency: (currencyId, changes) =>
      respond(() => {
        currency(currencyId);
        const owner = checkedOwner(changes);
        const median = checkedMedian(changes);
        const { active } = changes;
        if (
          owner === undefined &&
          median === undefined &&
          active === undefined
        ) {
          throw new ApiError(
            400,
            "Change the owner, the median or the status before saving.",
          );
        }

        return atomically(() => {
          if (active !== undefined) setActive(currencyId, active);
          if (owner !== undefined) state.ownerIds[currencyId] = owner;
          if (median !== undefined) resetReserve(currency(currencyId), median);

          return adminCurrency(currency(currencyId));
        });
      }),
    globalBlocks: createBlockList({
      level: "global",
      read: () => state.globalBlocks,
      write: (users) => {
        state.globalBlocks = users;
      },
      readInherited: () => [],
      findReversible: (userId, reverse) =>
        reversibleBy(userId, reverse, adminReversalFilter(reverse)),
      findCancellable: (userId) => pendingOf(userId, () => true),
      undo: undoAll,
    }),
    listAdmins: () => respond(() => state.admins),
    grantAdmin: (userId) =>
      respond(() => {
        const id = discordUserId(userId, "userId");
        if (state.admins.some((admin) => admin.userId === id)) {
          throw new ApiError(409, "That user is already an admin.", "userId");
        }

        const admin = { userId: id, username: null };
        state.admins = [...state.admins, admin];

        return admin;
      }),
    removeAdmin: (userId) =>
      respond(() => {
        if (userId === sampleCurrentUser.userId) {
          throw new ApiError(
            400,
            "You can't remove your own admin access. Ask another admin.",
          );
        }

        if (!state.admins.some((admin) => admin.userId === userId)) {
          throw notFound("admin");
        }

        state.admins = state.admins.filter((admin) => admin.userId !== userId);
      }),
  };
}
