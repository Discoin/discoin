import type { Currency } from "../../api/types.js";
import "./CurrencyTag.scss";

export function CurrencyTag({ currency }: { currency: Currency }) {
  return (
    <span class="currency-tag">
      <abbr class="currency-tag__code figure" title={currency.name}>
        {currency.abbreviation}
      </abbr>
      <span class="currency-tag__name">{currency.name}</span>
    </span>
  );
}
