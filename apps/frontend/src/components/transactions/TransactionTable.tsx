import type { ComponentChildren } from "preact";
import { TableFrame } from "../shared/TableFrame.jsx";
import type { CurrencyLabel, Transaction } from "../../api/types.js";
import { formatAmount, formatTimestamp } from "../../lib/format.js";
import { StatusPill } from "./StatusPill.jsx";
import { TransactionId } from "./TransactionId.jsx";
import "../shared/DataTable.scss";

export interface TransactionColumn {
  header: string;
  render: (transaction: Transaction) => ComponentChildren;
}

interface TransactionTableProps {
  caption: string;
  transactions: Transaction[];
  extraColumns?: TransactionColumn[];
}

function currencyLabelText(label: CurrencyLabel): string {
  if (!label.removed) return label.abbreviation;

  return `${label.abbreviation} (${label.name}, removed)`;
}

export function TransactionTable({
  caption,
  transactions,
  extraColumns = [],
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
            {extraColumns.map((column) => (
              <th key={column.header} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>
                <TransactionId id={transaction.id} />
              </td>
              <td class="data-table__number">
                {formatAmount(transaction.amount)}{" "}
                {currencyLabelText(transaction.fromCurrency)}
              </td>
              <td class="data-table__number">
                {formatAmount(transaction.payout)}{" "}
                {currencyLabelText(transaction.toCurrency)}
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
              {extraColumns.map((column) => (
                <td key={column.header}>{column.render(transaction)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
