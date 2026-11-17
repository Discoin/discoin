import type { ComponentChildren } from "preact";
import { useRoute } from "preact-iso";
import { api } from "../../api/client.js";
import { ApiError, TRANSACTION_ID_FIELD } from "../../api/errors.js";
import type { CurrentUser, TransactionDetail } from "../../api/types.js";
import { useSession } from "../../components/session/SessionProvider.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { currencyLabelText } from "../../components/transactions/currencyLabel.js";
import { StatusPill } from "../../components/transactions/StatusPill.jsx";
import {
  formatAmount,
  formatTimestamp,
  formatValue,
  shortTransactionId,
} from "../../lib/format.js";
import { parseTransactionId } from "../../lib/transactionId.js";
import { usePageTitle } from "../../lib/usePageTitle.js";
import { useRequest, type RequestState } from "../../lib/useRequest.js";
import { NotFound } from "../_404.jsx";
import { CauseText } from "./CauseText.jsx";
import { TransactionCurrency } from "./TransactionCurrency.jsx";
import "./style.scss";

const NOT_FOUND = 404;
const BAD_REQUEST = 400;
const WAITING_FOR_LOGIN: RequestState<TransactionDetail> = {
  status: "loading",
};

interface ScreenProps {
  id: string;
  state: RequestState<TransactionDetail>;
  onRetry: () => void;
}

function useTransactionId(): string | null {
  const { params } = useRoute();
  const id = params.id;
  if (id === undefined) {
    throw new Error("The transaction route needs an ID");
  }

  return parseTransactionId(id);
}

function viewerIdOf(state: RequestState<CurrentUser | null>): string | null {
  return state.status === "ready" && state.data !== null
    ? state.data.userId
    : null;
}

function isUnknownId(error: Error): boolean {
  if (!(error instanceof ApiError)) return false;

  return (
    error.status === NOT_FOUND ||
    (error.status === BAD_REQUEST && error.field === TRANSACTION_ID_FIELD)
  );
}

function isMissing(state: RequestState<TransactionDetail>): boolean {
  return state.status === "failed" && isUnknownId(state.error);
}

export function TransactionPage() {
  const id = useTransactionId();
  const session = useSession();
  if (id === null) return <NotFound />;

  if (session.state.status === "loading") {
    return (
      <TransactionScreen
        id={id}
        state={WAITING_FOR_LOGIN}
        onRetry={session.reload}
      />
    );
  }

  return <ViewedTransaction id={id} viewerId={viewerIdOf(session.state)} />;
}

function ViewedTransaction({
  id,
  viewerId,
}: {
  id: string;
  viewerId: string | null;
}) {
  const request = useRequest(() => api.getTransaction(id), [id, viewerId]);

  return (
    <TransactionScreen id={id} state={request.state} onRetry={request.reload} />
  );
}

function TransactionScreen(props: ScreenProps) {
  if (isMissing(props.state)) return <NotFound />;

  return <TransactionLayout {...props} />;
}

function TransactionLayout({ id, state, onRetry }: ScreenProps) {
  const shortId = shortTransactionId(id);
  usePageTitle(`Transaction ${shortId}`);

  return (
    <div class="page">
      <h1 class="transaction-page__title">
        Transaction <span class="figure">{shortId}</span>
      </h1>
      <Loadable state={state} label="transaction" onRetry={onRetry}>
        {(transaction) => <TransactionFacts transaction={transaction} />}
      </Loadable>
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div class="transaction-facts__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function rateText(transaction: TransactionDetail): string {
  const sent = currencyLabelText(transaction.fromCurrency);
  const received = currencyLabelText(transaction.toCurrency);
  const rate = formatValue(transaction.payout / transaction.amount);

  return `1 ${sent} = ${rate} ${received}`;
}

function TransactionFacts({ transaction }: { transaction: TransactionDetail }) {
  const { userId, cause, handledAt } = transaction;

  return (
    <dl class="transaction-facts">
      <Fact label="ID">
        <span class="figure">{transaction.id}</span>
      </Fact>
      <Fact label="Submitted">{formatTimestamp(transaction.submittedAt)}</Fact>
      {userId !== undefined && (
        <Fact label="User ID">
          <span class="figure">{userId}</span>
        </Fact>
      )}
      <Fact label="Sent">
        {formatAmount(transaction.amount)}{" "}
        <TransactionCurrency label={transaction.fromCurrency} />
      </Fact>
      <Fact label="Received">
        {formatAmount(transaction.payout)}{" "}
        <TransactionCurrency label={transaction.toCurrency} />
      </Fact>
      <Fact label="Status">
        <StatusPill status={transaction.status} />
      </Fact>
      <Fact label="Handled at">
        {handledAt === null ? "Not handled yet" : formatTimestamp(handledAt)}
      </Fact>
      <Fact label="Rate at the time of the trade">{rateText(transaction)}</Fact>
      {cause !== undefined && (
        <Fact label="Cause">
          <CauseText cause={cause} />
        </Fact>
      )}
    </dl>
  );
}
