import type { Currency } from "../../api/types.js";

export function CurrencyOptions({ currencies }: { currencies: Currency[] }) {
  return (
    <>
      {currencies.map((currency) => (
        <option key={currency.id} value={currency.id}>
          {currency.abbreviation} ({currency.name})
        </option>
      ))}
    </>
  );
}
