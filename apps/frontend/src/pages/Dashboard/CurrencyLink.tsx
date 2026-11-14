import type { Currency } from "../../api/types.js";
import { currencyPath } from "../../lib/currencyPath.js";
import { CurrencyTag } from "../../components/currency/CurrencyTag.jsx";
import "./CurrencyLink.scss";

export function CurrencyLink({ currency }: { currency: Currency }) {
  return (
    <a class="currency-link" href={currencyPath(currency.abbreviation)}>
      <CurrencyTag currency={currency} />
    </a>
  );
}
