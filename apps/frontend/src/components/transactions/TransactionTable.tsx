import type { ComponentChildren } from "preact";
import { TableFrame } from "../shared/TableFrame.jsx";
import type { Currency, Transaction } from "../../api/types.js";
import { findCurrency } from "../../lib/currencies.js";
import { formatAmount, formatTimestamp } from "../../lib/format.js";
import { StatusPill } from "./StatusPill.jsx";
import { TransactionId } from "./TransactionId.jsx";
import "../shared/DataTable.scss";

export interface TransactionAction {
  header: string;
  render: (transaction: Transaction) => ComponentChildren;
}

interface TransactionTableProps {
  caption: string;
  transactions: Transaction[];
  currencies: Currency[];
  action?: TransactionAction;
}

export function TransactionTable({
  caption,
  transactions,
  currencies,
  action,
}: TransactionTableProps) {
  return (
    <TableFrame label={caption}>
      <table class="data-table">
        <caption class="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Transaction</th>
            <th scope="col" class="data-table__number">
              Sent
            </th>
            <th scope="col" class="data-table__number">
              Received
            </th>
            <th scope="col">Status</th>
            <th scope="col">Submitted</th>
            <th scope="col">Handled</th>
            {action && <th scope="col">{action.header}</th>}
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const from = findCurrency(currencies, transaction.fromCurrencyId);
            const to = findCurrency(currencies, transaction.toCurrencyId);

            return (
              <tr key={transaction.id}>
                <td>
                  <TransactionId id={transaction.id} />
                </td>
                <td class="data-table__number">
                  {formatAmount(transaction.amount)} {from.abbreviation}
                </td>
                <td class="data-table__number">
                  {formatAmount(transaction.payout)} {to.abbreviation}
                </td>
                <td>
                  <StatusPill status={transaction.status} />
                </td>
                <td class="data-table__number">
                  {formatTimestamp(transaction.submittedAt)}
                </td>
                <td class="data-table__number">
                  {transaction.handledAt !== null &&
                    formatTimestamp(transaction.handledAt)}
                </td>
                {action && <td>{action.render(transaction)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}
