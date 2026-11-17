import type {
  BlockState,
  BotLabel,
  CurrencyLabel,
  Transaction,
  TransactionCause,
  TransactionDetail,
  TransactionRecord,
  TransactionStatus,
} from "../api/types.js";

const UNDONE_STATUSES: TransactionStatus[] = ["Cancelled", "Reversed"];

export interface CausingBlock {
  bot: BotLabel | null;
  liveOwnerId: string | null;
  reason: string;
  state: BlockState;
}

export interface ViewedTransaction {
  transaction: Transaction;
  senderId: string;
  sideOwnerIds: string[];
  causingBlock: CausingBlock | null;
}

export interface TransactionViewer {
  userId: string;
  isAdmin: boolean;
  ownsALiveBot: boolean;
}

interface Access {
  viewerId: string;
  isAdmin: boolean;
  isTrader: boolean;
  ownsASide: boolean;
  ownsALiveBot: boolean;
}

export function publicTransaction(
  record: TransactionRecord,
  labelOf: (currencyId: string) => CurrencyLabel,
): Transaction {
  return {
    id: record.id,
    fromCurrencyId: record.fromCurrencyId,
    toCurrencyId: record.toCurrencyId,
    amount: record.amount,
    payout: record.payout,
    status: record.status,
    submittedAt: record.submittedAt,
    handledAt: record.handledAt,
    fromCurrency: labelOf(record.fromCurrencyId),
    toCurrency: labelOf(record.toCurrencyId),
  };
}

function accessOf(
  viewed: ViewedTransaction,
  viewer: TransactionViewer,
): Access {
  return {
    viewerId: viewer.userId,
    isAdmin: viewer.isAdmin,
    isTrader: viewed.senderId === viewer.userId,
    ownsASide: viewed.sideOwnerIds.includes(viewer.userId),
    ownsALiveBot: viewer.ownsALiveBot,
  };
}

function isPrivileged(access: Access): boolean {
  return access.isAdmin || access.isTrader || access.ownsASide;
}

function mayReadReason(block: CausingBlock, access: Access): boolean {
  if (block.bot === null) return access.isAdmin || access.ownsALiveBot;

  return block.liveOwnerId === access.viewerId;
}

function causeOf(block: CausingBlock | null, access: Access): TransactionCause {
  if (block === null) return { kind: "none" };

  const reason = mayReadReason(block, access) ? { reason: block.reason } : {};

  if (block.bot === null) {
    return { kind: "global", state: block.state, ...reason };
  }

  return { kind: "bot", bot: block.bot, state: block.state, ...reason };
}

function privilegedView(
  viewed: ViewedTransaction,
  access: Access,
): TransactionDetail {
  const { transaction } = viewed;
  const withUser = { ...transaction, userId: viewed.senderId };
  if (!UNDONE_STATUSES.includes(transaction.status)) return withUser;

  return { ...withUser, cause: causeOf(viewed.causingBlock, access) };
}

export function viewTransaction(
  viewed: ViewedTransaction,
  viewer: TransactionViewer | null,
): TransactionDetail {
  if (viewer === null) return viewed.transaction;

  const access = accessOf(viewed, viewer);
  if (!isPrivileged(access)) return viewed.transaction;

  return privilegedView(viewed, access);
}
