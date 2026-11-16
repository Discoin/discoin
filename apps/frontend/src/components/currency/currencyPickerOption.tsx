import type { Currency } from "../../api/types.js";
import type { PickerOption } from "../shared/Picker.jsx";
import { CurrencyTag } from "./CurrencyTag.jsx";
import "./currencyPickerOption.scss";

export function currencyLabel(currency: Currency): string {
  return `${currency.abbreviation} (${currency.name})`;
}

export function currencyChoiceLabel(currency: Currency): string {
  const label = currencyLabel(currency);

  return currency.active ? label : `${label}, inactive`;
}

export function currencyPickerOption(currency: Currency): PickerOption {
  return {
    value: currency.id,
    text: currencyChoiceLabel(currency),
    content: (
      <>
        <CurrencyTag currency={currency} />
        {!currency.active && (
          <span class="currency-picker-option__state">Inactive</span>
        )}
      </>
    ),
  };
}
