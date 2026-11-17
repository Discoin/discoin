import { shortTransactionId } from "../../lib/format.js";
import { transactionPath } from "../../lib/transactionPath.js";
import "./TransactionId.scss";

export function TransactionId({ id }: { id: string }) {
  return (
    <a class="transaction-id figure" href={transactionPath(id)} title={id}>
      <span aria-hidden="true">{shortTransactionId(id)}</span>
      <span class="visually-hidden">Transaction {id}</span>
    </a>
  );
}
