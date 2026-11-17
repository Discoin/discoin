import type { CurrencyLabel } from "../../api/types.js";
import { currencyLabelText } from "../../components/transactions/currencyLabel.js";
import { currencyPath } from "../../lib/currencyPath.js";

export function TransactionCurrency({ label }: { label: CurrencyLabel }) {
  if (label.removed) return <>{currencyLabelText(label)}</>;

  return <a href={currencyPath(label.abbreviation)}>{label.abbreviation}</a>;
}
