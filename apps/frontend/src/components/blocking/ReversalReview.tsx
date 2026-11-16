import type { Transaction } from "../../api/types.js";
import { formatTransactionCount } from "../../lib/format.js";
import { Button } from "../shared/Button.jsx";
import { Notice } from "../shared/Notice.jsx";
import { TransactionTable } from "../transactions/TransactionTable.jsx";
import "./ReversalReview.scss";

interface ReversalReviewProps {
  transactions: Transaction[];
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

export function ReversalReview({
  transactions,
  pending,
  onConfirm,
  onBack,
}: ReversalReviewProps) {
  const count = formatTransactionCount(transactions.length);

  return (
    <div class="reversal-review">
      <h3 class="reversal-review__title" tabIndex={-1}>
        Review the reversal
      </h3>
      <p class="reversal-review__count">
        <span class="reversal-review__total figure">{count}</span> to reverse
      </p>
      {transactions.length > 0 && (
        <>
          <TransactionTable
            caption="Transactions to reverse"
            transactions={transactions}
          />
          <Notice tone="warning" title="Bots take the coins back">
            <p>
              Discoin tells each receiving bot to take the coins back from this
              user. This can't be undone.
            </p>
          </Notice>
        </>
      )}
      <div class="form-actions">
        <Button variant="danger" disabled={pending} onClick={onConfirm}>
          {transactions.length > 0
            ? `Block and reverse ${count}`
            : "Block user"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
