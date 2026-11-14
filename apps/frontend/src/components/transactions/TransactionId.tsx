import { shortTransactionId } from "../../lib/format.js";
import "./TransactionId.scss";

export function TransactionId({ id }: { id: string }) {
  return (
    <code class="transaction-id figure" title={id}>
      <span aria-hidden="true">{shortTransactionId(id)}</span>
      <span class="visually-hidden">{id}</span>
    </code>
  );
}
