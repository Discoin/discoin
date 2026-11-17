import type { CurrencyLabel } from "../../api/types.js";

export function currencyLabelText(label: CurrencyLabel): string {
  if (!label.removed) return label.abbreviation;

  return `${label.abbreviation} (${label.name}, removed)`;
}
