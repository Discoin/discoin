import type { TransactionStatus } from "../../api/types.js";
import "./StatusPill.scss";

export function StatusPill({ status }: { status: TransactionStatus }) {
  return (
    <span class={`status-pill status-pill--${status.toLowerCase()}`}>
      {status}
    </span>
  );
}
