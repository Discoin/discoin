import type { BlockListApi, DiscoinApi } from "../api/client.js";
import { ApiError, TRANSACTION_ID_FIELD } from "../api/errors.js";
import type {
  AdminBot,
  AdminCurrency,
  AdminUser,
  BlockedUser,
  BlockLevel,
  BotDetails,
  BotName,
  BotSettings,
  BotWithCurrencies,
  Currency,
  CurrencyChanges,
  CurrencyDetails,
  CurrencyLabel,
  CurrencySettings,
  CurrentUser,
  NewCurrency,
  PendingTransaction,
  RemovalPreview,
  ReservePoint,
  ReverseRequest,
  Transaction,
  TransactionRecord,
  TransactionStatus,
} from "../api/types.js";
import { hasAtMostCents, MAX_SEND_AMOUNT } from "../lib/converter.js";
import {
  calculatePayout,
  currencyValue,
  reservesAfterUndo,
  startingReserve,
} from "../lib/exchange.js";
import { formatAmount } from "../lib/format.js";
import { parseTransactionId } from "../lib/transactionId.js";
import {
  type MockBlockRecord,
  type MockBot,
  type RemovedCurrency,
  sampleAdmins,
  sampleBlockRecords,
  sampleBotBlocks,
  sampleBotIds,
  sampleBots,
  sampleCurrencies,
  sampleCurrencyBlocks,
  sampleDailyCaps,
  sampleGlobalBlocks,
  sampleMultipliers,
  sampleRemovedCurrencies,
  sampleReserveHistories,
  sampleTransactionBlocks,
  sampleTransactionSenders,
  sampleTransactions,
  sampleWeeklyMedians,
} from "./data.js";
import { failedLogout, logoutFails } from "./failingLogout.js";
import { marketStartsInactive } from "./inactiveMarket.js";
import {
  lostConnection,
  renameFindsCurrencyDeactivated,
  renamesLoseConnection,
  renamesStall,
} from "./ownerScenarios.js";
import {
  adminReversalFilter,
  ownerReversalFilter,
  selectReversible,
  type TransactionFilter,
} from "./reversals.js";
import {
  publicTransaction,
  type CausingBlock,
  type TransactionViewer,
  type ViewedTransaction,
  viewTransaction,
} from "./transactionView.js";
import { mockViewerId } from "./viewer.js";

export const LATENCY_MS = 300;
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
const MAX_RESERVE = 99_999_999_999_999.99;
const MAX_RESERVE_TEXT = "99,999,999,999,999.99";
const PICK_A_BOT = "Pick the bot that runs this currency.";

interface ReserveTerms {
  weeklyMedian: number;
  multiplier: number;
  blamedField: string;
}

interface MockState {
  currencies: Currency[];
  removedCurrencies: RemovedCurrency[];
  histories: Record<string, ReservePoint[]>;
  weeklyMedians: Record<string, number>;
  multipliers: Record<string, number>;
  bots: MockBot[];
  botIds: Record<string, string | null>;
  dailyCaps: Record<string, number | null>;
  transactions: TransactionRecord[];
  transactionSenders: Record<string, string>;
  blocks: MockBlockRecord[];
  transactionBlocks: Record<string, string>;
  removedBots: BotName[];
  botBlocks: Record<string, BlockedUser[]>;
  currencyBlocks: Record<string, BlockedUser[]>;
  globalBlocks: BlockedUser[];
  admins: AdminUser[];
  loggedIn: boolean;
}

function initialState(): MockState {
  const state = sampleState();
  if (marketStartsInactive()) {
    state.currencies = state.currencies.map((found) => ({
      ...found,
      active: false,
    }));
  }

  return state;
}

function sampleState(): MockState {
  return structuredClone({
    currencies: sampleCurrencies,
    removedCurrencies: sampleRemovedCurrencies,
    histories: sampleReserveHistories,
    weeklyMedians: sampleWeeklyMedians,
    multipliers: sampleMultipliers,
    bots: sampleBots,
    botIds: sampleBotIds,
    dailyCaps: sampleDailyCaps,
    transactions: sampleTransactions,
    transactionSenders: sampleTransactionSenders,
    blocks: sampleBlockRecords,
    transactionBlocks: sampleTransactionBlocks,
    removedBots: [],
    botBlocks: sampleBotBlocks,
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

function checkedMedian(weeklyMedian: number): number {
  return positiveAmount(weeklyMedian, "weeklyMedian", "weekly median");
}

function sentReserveValue(value: number, field: string, label: string): number {
  if (Number.isNaN(value)) {
    throw new ApiError(400, `Enter the ${label}.`, field);
  }

  return value;
}

function checkedMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new ApiError(
      400,
      "The reserve multiplier must be above 0.",
      "multiplier",
    );
  }

  if (!hasAtMostCents(multiplier)) {
    throw new ApiError(
      400,
      "The reserve multiplier can have at most 2 decimals.",
      "multiplier",
    );
  }

  return multiplier;
}

function checkedStartingReserve(terms: ReserveTerms): number {
  if (terms.weeklyMedian * terms.multiplier > MAX_RESERVE) {
    throw new ApiError(
      400,
      `This median and multiplier give a reserve above ${MAX_RESERVE_TEXT}. Lower one of them.`,
      terms.blamedField,
    );
  }

  const reserve = startingReserve(terms.weeklyMedian, terms.multiplier);
  if (reserve <= 0) {
    throw new ApiError(
      400,
      "This median and multiplier give a reserve below 0.01. Raise one of them.",
      terms.blamedField,
    );
  }

  return reserve;
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

function checkedBotDetails(bot: BotDetails, others: MockBot[]): BotDetails {
  const details = {
    name: requiredText(bot.name, "name", "bot name"),
    discordId: discordUserId(bot.discordId, "discordId"),
    ownerId: discordUserId(bot.ownerId, "ownerId"),
  };
  if (others.some((other) => other.discordId === details.discordId)) {
    throw new ApiError(
      409,
      "Another bot already has that Discord ID.",
      "discordId",
    );
  }

  return details;
}

function withoutCredentials(bot: MockBot): MockBot {
  return {
    ...bot,
    hasApiToken: false,
    hasWebhookSecret: false,
    webhookUrl: null,
  };
}

function byName(bots: MockBot[]): MockBot[] {
  return [...bots].sort((a, b) => a.name.localeCompare(b.name));
}

function isListed(users: BlockedUser[], userId: string): boolean {
  return users.some((user) => user.userId === userId);
}

function mergedBlocks(
  kept: BlockedUser[],
  moving: BlockedUser[],
): BlockedUser[] {
  const byUser = new Map(kept.map((user) => [user.userId, user]));

  for (const user of moving) {
    const existing = byUser.get(user.userId);
    if (existing === undefined || user.blockedAt < existing.blockedAt) {
      byUser.set(user.userId, user);
    }
  }

  return [...byUser.values()];
}

interface BlockStore {
  level: BlockLevel;
  read: () => BlockedUser[];
  write: (users: BlockedUser[]) => void;
  readInherited: () => BlockedUser[];
  findReversible: (userId: string, reverse: ReverseRequest) => Transaction[];
  findCancellable: (userId: string) => TransactionRecord[];
  record: (blocked: BlockedUser) => string;
  lift: (userId: string) => void;
  undo: (
    transactions: TransactionRecord[],
    status: TransactionStatus,
    blockId: string,
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
        const blockId = store.record(blocked);
        const reversed = store.undo(toReverse, "Reversed", blockId);
        store.undo(store.findCancellable(blocked.userId), "Cancelled", blockId);
        write([blocked, ...read()]);

        return { blocked, reversed };
      }),
    previewBlock: (userId, reason, reverse) =>
      respond(() => plan(userId, reason, reverse).toReverse),
    unblock: (userId) =>
      respond(() => {
        if (!isListed(read(), userId)) throw notFound("blocked user");

        write(read().filter((user) => user.userId !== userId));
        store.lift(userId);
      }),
  };
}

export function createMockApi(): DiscoinApi {
  const state = initialState();
  const viewerId = mockViewerId();

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

  function bot(id: string): MockBot {
    const found = state.bots.find((candidate) => candidate.id === id);
    if (found === undefined) throw notFound("bot");

    return found;
  }

  function replaceBot(updated: MockBot): void {
    state.bots = state.bots.map((candidate) =>
      candidate.id === updated.id ? updated : candidate,
    );
  }

  function botIdOf(currencyId: string): string | null {
    return lookup(state.botIds, currencyId, "currency");
  }

  function currencyIdsOf(botId: string): string[] {
    return currenciesOf(botId).map((found) => found.id);
  }

  function requireOwnerOf(found: MockBot, subject: string): MockBot {
    if (found.ownerId !== viewerId) {
      throw new ApiError(403, `You don't own that ${subject}.`);
    }

    return found;
  }

  function ownedBot(botId: string): MockBot {
    return requireOwnerOf(bot(botId), "bot");
  }

  function botOfOwnedCurrency(currencyId: string): MockBot {
    currency(currencyId);
    const botId = botIdOf(currencyId);
    if (botId === null) {
      throw new ApiError(
        403,
        "This currency has no bot yet, so nobody owns it. Ask a Discoin admin to assign its bot.",
      );
    }

    return requireOwnerOf(bot(botId), "currency");
  }

  function ownedCurrency(id: string): Currency {
    botOfOwnedCurrency(id);

    return currency(id);
  }

  function writableCurrency(id: string): Currency {
    const found = ownedCurrency(id);
    if (!found.active) {
      throw new ApiError(
        400,
        `${found.abbreviation} is inactive, so its settings can't be changed until a Discoin admin reactivates it.`,
        "currencyId",
      );
    }

    return found;
  }

  function updateOwnedBot(
    botId: string,
    change: (found: MockBot) => MockBot,
  ): void {
    replaceBot(change(ownedBot(botId)));
  }

  function botSettings(botId: string): BotSettings {
    const { hasApiToken, hasWebhookSecret, webhookUrl } = ownedBot(botId);

    return { hasApiToken, hasWebhookSecret, webhookUrl };
  }

  function currencySettings(currencyId: string): CurrencySettings {
    ownedCurrency(currencyId);

    return { dailyCap: lookup(state.dailyCaps, currencyId, "currency") };
  }

  function currentUsersBots(): MockBot[] {
    return byName(state.bots).filter((found) => found.ownerId === viewerId);
  }

  function currenciesOf(botId: string): Currency[] {
    return state.currencies
      .filter((found) => state.botIds[found.id] === botId)
      .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  }

  function labelOf(currencyId: string): CurrencyLabel {
    const live = state.currencies.find((found) => found.id === currencyId);
    if (live !== undefined) {
      return {
        abbreviation: live.abbreviation,
        name: live.name,
        removed: false,
      };
    }

    const removed = state.removedCurrencies.find(
      (found) => found.id === currencyId,
    );
    if (removed === undefined) {
      throw new Error(`Transaction names an unknown currency "${currencyId}"`);
    }

    return {
      abbreviation: removed.abbreviation,
      name: removed.name,
      removed: true,
    };
  }

  function labeled(record: TransactionRecord): Transaction {
    return publicTransaction(record, labelOf);
  }

  function labeledWhere(involves: TransactionFilter): Transaction[] {
    return state.transactions.filter(involves).map(labeled);
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
    const botId = botIdOf(found.id);

    return {
      currency: found,
      weeklyMedian: lookup(state.weeklyMedians, found.id, "weekly median"),
      multiplier: lookup(state.multipliers, found.id, "multiplier"),
      bot: botId === null ? null : { id: botId, name: bot(botId).name },
    };
  }

  function adminBot(found: MockBot): AdminBot {
    const { id, name, discordId, ownerId } = found;

    return {
      id,
      name,
      discordId,
      ownerId,
      currencyCount: currencyIdsOf(id).length,
    };
  }

  function checkedBotId(botId: string | null): string {
    if (botId === null) throw new ApiError(400, PICK_A_BOT, "botId");

    if (!state.bots.some((candidate) => candidate.id === botId)) {
      throw new ApiError(404, "No bot with that ID.", "botId");
    }

    return botId;
  }

  function checkedAssignment(
    currencyId: string,
    changes: CurrencyChanges,
  ): string | undefined {
    if (!("botId" in changes)) return undefined;

    if (botIdOf(currencyId) !== null) {
      throw new ApiError(
        409,
        "This currency already has a bot. Currencies can't change bot.",
        "botId",
      );
    }

    return checkedBotId(changes.botId ?? null);
  }

  function ownBlocks(currencyId: string): BlockedUser[] {
    if (botIdOf(currencyId) !== null) return [];

    return lookup(state.currencyBlocks, currencyId, "currency");
  }

  function assignBot(currencyId: string, botId: string): number {
    const moving = ownBlocks(currencyId);
    state.botIds[currencyId] = botId;
    state.botBlocks[botId] = mergedBlocks(
      lookup(state.botBlocks, botId, "bot"),
      moving,
    );
    delete state.currencyBlocks[currencyId];

    return moving.length;
  }

  function changedReserveTerms(
    currencyId: string,
    changes: CurrencyChanges,
  ): ReserveTerms | undefined {
    const { weeklyMedian, multiplier } = changes;
    if (weeklyMedian === undefined && multiplier === undefined) {
      return undefined;
    }

    return {
      weeklyMedian:
        weeklyMedian === undefined
          ? lookup(state.weeklyMedians, currencyId, "weekly median")
          : checkedMedian(
              sentReserveValue(weeklyMedian, "weeklyMedian", "weekly median"),
            ),
      multiplier:
        multiplier === undefined
          ? lookup(state.multipliers, currencyId, "multiplier")
          : checkedMultiplier(
              sentReserveValue(multiplier, "multiplier", "reserve multiplier"),
            ),
      blamedField: multiplier === undefined ? "weeklyMedian" : "multiplier",
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

  function resetReserve(currencyId: string, terms: ReserveTerms): void {
    setReserve(currencyId, checkedStartingReserve(terms));
    state.weeklyMedians[currencyId] = terms.weeklyMedian;
    state.multipliers[currencyId] = terms.multiplier;
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
    transaction: TransactionRecord,
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

    return labeled(undone);
  }

  function undoAll(
    transactions: TransactionRecord[],
    status: TransactionStatus,
  ): Transaction[] {
    return atomically(() =>
      transactions.map((transaction) => undoOne(transaction, status)),
    );
  }

  function undoForBlock(
    transactions: TransactionRecord[],
    status: TransactionStatus,
    blockId: string,
  ): Transaction[] {
    const undone = undoAll(transactions, status);
    for (const transaction of undone) {
      state.transactionBlocks[transaction.id] = blockId;
    }

    return undone;
  }

  function senderOf(transaction: TransactionRecord): string {
    return lookup(state.transactionSenders, transaction.id, "transaction");
  }

  function involvesCurrency(currencyId: string): TransactionFilter {
    return (transaction) =>
      transaction.fromCurrencyId === currencyId ||
      transaction.toCurrencyId === currencyId;
  }

  function involvesAny(currencyIds: string[]): TransactionFilter {
    return (transaction) =>
      currencyIds.includes(transaction.fromCurrencyId) ||
      currencyIds.includes(transaction.toCurrencyId);
  }

  function bothSidesLive(transaction: TransactionRecord): boolean {
    const ids = state.currencies.map((found) => found.id);

    return (
      ids.includes(transaction.fromCurrencyId) &&
      ids.includes(transaction.toCurrencyId)
    );
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

  function pendingInvolving(currencyIds: string[]): TransactionRecord[] {
    const involves = involvesAny(currencyIds);

    return state.transactions.filter(
      (transaction) =>
        transaction.status === "Pending" && involves(transaction),
    );
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

  function viewerAsAdmin(): AdminUser | undefined {
    return state.admins.find((admin) => admin.userId === viewerId);
  }

  function currentUser(): CurrentUser | null {
    if (!state.loggedIn) return null;

    const admin = viewerAsAdmin();
    const ownedBots = currentUsersBots().map((found) => ({
      id: found.id,
      name: found.name,
      currencyIds: currencyIdsOf(found.id),
    }));

    return {
      userId: viewerId,
      username: admin === undefined ? null : admin.username,
      avatarUrl: SAMPLE_AVATAR,
      defaultAvatarUrl: SAMPLE_AVATAR,
      isAdmin: admin !== undefined,
      ownedBots,
    };
  }

  function currentViewer(): TransactionViewer | null {
    if (!state.loggedIn) return null;

    return {
      userId: viewerId,
      isAdmin: viewerAsAdmin() !== undefined,
      ownsALiveBot: currentUsersBots().length > 0,
    };
  }

  function checkedTransactionId(value: string): string {
    const id = parseTransactionId(value);
    if (id === null) {
      throw new ApiError(
        400,
        `${TRANSACTION_ID_FIELD} is not valid.`,
        TRANSACTION_ID_FIELD,
      );
    }

    return id;
  }

  function transactionRecord(transactionId: string): TransactionRecord {
    const id = checkedTransactionId(transactionId);
    const found = state.transactions.find((candidate) => candidate.id === id);
    if (found === undefined) throw notFound("transaction");

    return found;
  }

  function liveOwnerIdsOf(currencyId: string): string[] {
    const live = state.currencies.some((found) => found.id === currencyId);
    const botId = live ? botIdOf(currencyId) : null;
    const liveBot = state.bots.find((found) => found.id === botId);

    return liveBot === undefined ? [] : [liveBot.ownerId];
  }

  function blockingBotOf(
    botId: string | null,
  ): Pick<CausingBlock, "bot" | "liveOwnerId"> {
    if (botId === null) return { bot: null, liveOwnerId: null };

    const live = state.bots.find((found) => found.id === botId);
    if (live !== undefined) {
      return {
        bot: { name: live.name, removed: false },
        liveOwnerId: live.ownerId,
      };
    }

    const removed = state.removedBots.find((found) => found.id === botId);
    if (removed === undefined) {
      throw new Error(`A block names an unknown bot "${botId}"`);
    }

    return { bot: { name: removed.name, removed: true }, liveOwnerId: null };
  }

  function causingBlockOf(transactionId: string): CausingBlock | null {
    if (!(transactionId in state.transactionBlocks)) return null;

    const blockId = state.transactionBlocks[transactionId];
    const block = state.blocks.find((found) => found.id === blockId);
    if (block === undefined) {
      throw new Error(`A transaction names an unknown block "${blockId}"`);
    }

    return {
      ...blockingBotOf(block.botId),
      reason: block.reason,
      state: block.state,
    };
  }

  function viewedTransaction(record: TransactionRecord): ViewedTransaction {
    return {
      transaction: labeled(record),
      senderId: senderOf(record),
      sideOwnerIds: [record.fromCurrencyId, record.toCurrencyId].flatMap(
        liveOwnerIdsOf,
      ),
      causingBlock: causingBlockOf(record.id),
    };
  }

  function recordBlock(blocked: BlockedUser, botId: string | null): string {
    const id = crypto.randomUUID();
    const { userId, reason } = blocked;
    state.blocks = [
      ...state.blocks,
      { id, userId, botId, reason, state: "active" },
    ];

    return id;
  }

  function liftBlock(userId: string, botId: string | null): void {
    state.blocks = state.blocks.map((block) =>
      block.userId === userId &&
      block.botId === botId &&
      block.state === "active"
        ? { ...block, state: "lifted" }
        : block,
    );
  }

  function setActive(currencyId: string, active: boolean): void {
    if (currency(currencyId).active === active) return;

    if (!active) undoAll(pendingInvolving([currencyId]), "Cancelled");
    replaceCurrency({ ...currency(currencyId), active });
  }

  function retireCurrencies(currencyIds: string[]): void {
    undoAll(pendingInvolving(currencyIds), "Cancelled");
    const retired = state.currencies.filter((found) =>
      currencyIds.includes(found.id),
    );
    state.currencies = state.currencies.filter(
      (found) => !currencyIds.includes(found.id),
    );
    state.removedCurrencies = [
      ...state.removedCurrencies,
      ...retired.map(({ id, abbreviation, name, reserve }) => ({
        id,
        abbreviation,
        name,
        reserve,
      })),
    ];
  }

  function removalPreview(
    currencyIds: string[],
    enforcedBlocks: number,
  ): RemovalPreview {
    return {
      currencies: currencyIds.map((id) => {
        const { abbreviation, name } = currency(id);

        return { id, abbreviation, name };
      }),
      pendingTransactions: pendingInvolving(currencyIds).length,
      enforcedBlocks,
    };
  }

  function reversibleBy(
    userId: string,
    reverse: ReverseRequest,
    involves: TransactionFilter,
  ): Transaction[] {
    return selectReversible(state.transactions.filter(bothSidesLive), {
      senders: state.transactionSenders,
      userId,
      window: reverse.window,
      involves,
    }).map(labeled);
  }

  return {
    listCurrencies: () =>
      respond(() => state.currencies.filter((found) => found.active)),
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
      respond(() => {
        currency(currencyId);

        return labeledWhere(involvesCurrency(currencyId));
      }),
    getReserveHistory: (currencyId, days) =>
      respond(() => {
        currency(currencyId);
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
        if (logoutFails()) throw failedLogout();

        state.loggedIn = false;
      }),
    listRecentTransactions: () => respond(() => labeledWhere(() => true)),
    getTransaction: (transactionId) =>
      respond(() =>
        viewTransaction(
          viewedTransaction(transactionRecord(transactionId)),
          currentViewer(),
        ),
      ),
    listMyTransactions: () =>
      respond(() =>
        labeledWhere((transaction) => senderOf(transaction) === viewerId),
      ),

    listOwnedBots: () =>
      respond(() =>
        currentUsersBots().map(
          (found): BotWithCurrencies => ({
            id: found.id,
            name: found.name,
            currencies: currenciesOf(found.id),
          }),
        ),
      ),
    getBotSettings: (botId) => respond(() => botSettings(botId)),
    getCurrencySettings: (currencyId) =>
      respond(() => currencySettings(currencyId)),
    updateCurrencyDetails: (currencyId, details) => {
      if (renamesStall()) return new Promise<Currency>(() => undefined);

      return respond(() => {
        if (renamesLoseConnection()) throw lostConnection();
        if (renameFindsCurrencyDeactivated()) setActive(currencyId, false);

        const updated = {
          ...writableCurrency(currencyId),
          ...checkedDetails(
            details,
            state.currencies.filter((candidate) => candidate.id !== currencyId),
          ),
        };
        replaceCurrency(updated);

        return updated;
      });
    },
    regenerateApiToken: (botId) =>
      respond(() => {
        updateOwnedBot(botId, (found) => ({
          ...found,
          hasApiToken: true,
        }));

        return randomToken(TOKEN_PREFIX);
      }),
    generateWebhookSecret: (botId) =>
      respond(() => {
        updateOwnedBot(botId, (found) => ({
          ...found,
          hasWebhookSecret: true,
        }));

        return randomToken(SECRET_PREFIX);
      }),
    setWebhookUrl: (botId, url) =>
      respond(() => {
        const checked = webhookUrl(url);
        if (!ownedBot(botId).hasWebhookSecret) {
          throw new ApiError(
            400,
            "Generate a webhook secret first, so Discoin can sign each webhook.",
            "webhookUrl",
          );
        }

        updateOwnedBot(botId, (found) => ({
          ...found,
          webhookUrl: checked,
        }));
      }),
    testWebhook: (botId) =>
      respond(() => {
        if (ownedBot(botId).webhookUrl === null) {
          throw new ApiError(
            400,
            "Save a webhook URL before sending a test.",
            "webhookUrl",
          );
        }

        return MOCK_WEBHOOK_STATUS;
      }),
    removeWebhookUrl: (botId) =>
      respond(() => {
        updateOwnedBot(botId, (found) => ({ ...found, webhookUrl: null }));
      }),
    setDailyCap: (currencyId, cap) =>
      respond(() => {
        writableCurrency(currencyId);
        state.dailyCaps[currencyId] = positiveAmount(
          cap,
          "dailyCap",
          "daily cap",
        );
      }),
    removeDailyCap: (currencyId) =>
      respond(() => {
        writableCurrency(currencyId);
        state.dailyCaps[currencyId] = null;
      }),
    listPendingTransactions: (botId) =>
      respond(() => {
        ownedBot(botId);
        const botCurrencyIds = currencyIdsOf(botId);

        return labeledWhere(
          (transaction) =>
            botCurrencyIds.includes(transaction.toCurrencyId) &&
            transaction.status === "Pending",
        ).map(
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

        const receivingBot = botOfOwnedCurrency(transaction.toCurrencyId);

        if (transaction.status !== "Pending") {
          throw new ApiError(400, "Only Pending transactions can be resent.");
        }

        if (receivingBot.webhookUrl === null) {
          throw new ApiError(
            400,
            "Add a webhook URL before resending. Your bot can still poll for this transaction.",
          );
        }
      }),
    botBlocks: (botId) =>
      createBlockList({
        level: "bot",
        read: () => lookup(state.botBlocks, ownedBot(botId).id, "bot"),
        write: (users) => {
          state.botBlocks[ownedBot(botId).id] = users;
        },
        readInherited: () => state.globalBlocks,
        findReversible: (userId, reverse) =>
          reversibleBy(
            userId,
            reverse,
            ownerReversalFilter(currencyIdsOf(botId), reverse),
          ),
        findCancellable: (userId) =>
          pendingOf(userId, involvesAny(currencyIdsOf(botId))),
        record: (blocked) => recordBlock(blocked, botId),
        lift: (userId) => liftBlock(userId, botId),
        undo: undoForBlock,
      }),

    listAdminCurrencies: () =>
      respond(() => state.currencies.map(adminCurrency)),
    addCurrency: (newCurrency: NewCurrency) =>
      respond(() => {
        const details = checkedDetails(newCurrency, state.currencies);
        const terms = {
          weeklyMedian: checkedMedian(newCurrency.weeklyMedian),
          multiplier: checkedMultiplier(newCurrency.multiplier),
          blamedField: "multiplier",
        };
        const reserve = checkedStartingReserve(terms);
        const botId = checkedBotId(newCurrency.botId);
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
        state.weeklyMedians[added.id] = terms.weeklyMedian;
        state.multipliers[added.id] = terms.multiplier;
        state.botIds[added.id] = botId;
        state.dailyCaps[added.id] = null;
        state.histories[added.id] = [now - DAY_MS, now].map((at) => ({
          at: new Date(at).toISOString(),
          reserve,
        }));

        return adminCurrency(added);
      }),
    updateCurrency: (currencyId, changes) =>
      respond(() => {
        currency(currencyId);
        const botId = checkedAssignment(currencyId, changes);
        const terms = changedReserveTerms(currencyId, changes);
        const { active } = changes;
        if (
          botId === undefined &&
          terms === undefined &&
          active === undefined
        ) {
          throw new ApiError(
            400,
            "Pick a bot, change the median, the multiplier or the status before saving.",
          );
        }

        return atomically(() => {
          if (active !== undefined) setActive(currencyId, active);
          const movedBlocks =
            botId === undefined ? 0 : assignBot(currencyId, botId);
          if (terms !== undefined) resetReserve(currencyId, terms);

          return { saved: adminCurrency(currency(currencyId)), movedBlocks };
        });
      }),
    previewCurrencyRemoval: (currencyId) =>
      respond(() => {
        currency(currencyId);

        return removalPreview([currencyId], ownBlocks(currencyId).length);
      }),
    removeCurrency: (currencyId) =>
      respond(() => {
        currency(currencyId);
        atomically(() => retireCurrencies([currencyId]));
      }),
    listAdminBots: () => respond(() => byName(state.bots).map(adminBot)),
    addBot: (details) =>
      respond(() => {
        const added: MockBot = {
          id: crypto.randomUUID(),
          ...checkedBotDetails(details, state.bots),
          hasApiToken: false,
          hasWebhookSecret: false,
          webhookUrl: null,
        };
        state.bots = [...state.bots, added];
        state.botBlocks[added.id] = [];

        return adminBot(added);
      }),
    updateBot: (botId, changes) =>
      respond(() => {
        const stored = bot(botId);
        if (Object.keys(changes).length === 0) {
          throw new ApiError(
            400,
            "Change the name, the Discord ID or the owner before saving.",
          );
        }

        const details = checkedBotDetails(
          { ...stored, ...changes },
          state.bots.filter((candidate) => candidate.id !== botId),
        );
        const updated = { ...stored, ...details };
        replaceBot(
          details.ownerId === stored.ownerId
            ? updated
            : withoutCredentials(updated),
        );

        return adminBot(bot(botId));
      }),
    previewBotRemoval: (botId) =>
      respond(() => {
        bot(botId);

        return removalPreview(
          currencyIdsOf(botId),
          lookup(state.botBlocks, botId, "bot").length,
        );
      }),
    removeBot: (botId) =>
      respond(() => {
        const { name } = bot(botId);
        atomically(() => {
          retireCurrencies(currencyIdsOf(botId));
          state.bots = state.bots.filter((candidate) => candidate.id !== botId);
          state.removedBots = [...state.removedBots, { id: botId, name }];
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
      record: (blocked) => recordBlock(blocked, null),
      lift: (userId) => liftBlock(userId, null),
      undo: undoForBlock,
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
        if (userId === viewerId) {
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
