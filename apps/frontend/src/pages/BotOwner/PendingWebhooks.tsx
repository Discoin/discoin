import { api } from "../../api/client.js";
import type { Transaction } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { EmptyState } from "../../components/shared/EmptyState.jsx";
import { TransactionTable } from "../../components/transactions/TransactionTable.jsx";
import { shortTransactionId } from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";

interface PendingWebhooksProps {
  pending: Transaction[];
}

export function PendingWebhooks({ pending }: PendingWebhooksProps) {
  const action = useAction();

  function resend(transactionId: string) {
    void action.run(async () => {
      await api.resendWebhook(transactionId);

      return `Receipt for ${shortTransactionId(transactionId)} sent again.`;
    });
  }

  if (pending.length === 0) {
    return (
      <EmptyState title="Nothing pending">
        <p>Every transaction into this bot's currencies has been handled.</p>
      </EmptyState>
    );
  }

  return (
    <div class="stack-tight">
      <TransactionTable
        caption="Pending transactions"
        transactions={pending}
        extraColumns={[
          {
            header: "Currency",
            render: (transaction) => transaction.toCurrency.abbreviation,
          },
          {
            header: "Webhook",
            render: (transaction) => (
              <Button
                variant="secondary"
                disabled={action.state.status === "pending"}
                onClick={() => resend(transaction.id)}
              >
                Resend
                <span class="visually-hidden">
                  {" "}
                  receipt for {shortTransactionId(transaction.id)}
                </span>
              </Button>
            ),
          },
        ]}
      />
      <ActionStatus state={action.state} inlineFields={[]} />
    </div>
  );
}
