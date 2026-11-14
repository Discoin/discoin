import { useId } from "preact/hooks";
import type { Currency } from "../../api/types.js";
import { CurrencyOptions } from "./CurrencyOptions.jsx";
import "./CurrencyAmountField.scss";

interface CurrencyAmountFieldProps {
  label: string;
  amountText: string;
  currencyId: string;
  currencies: Currency[];
  error: string | undefined;
  onAmountInput: (text: string) => void;
  onCurrencyChange: (currencyId: string) => void;
}

export function CurrencyAmountField({
  label,
  amountText,
  currencyId,
  currencies,
  error,
  onAmountInput,
  onCurrencyChange,
}: CurrencyAmountFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div
      class={
        error === undefined
          ? "currency-amount"
          : "currency-amount currency-amount--invalid"
      }
    >
      <label class="currency-amount__label" for={id}>
        {label}
      </label>
      <div class="currency-amount__control">
        <input
          id={id}
          class="currency-amount__input"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amountText}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          onInput={(event) => onAmountInput(event.currentTarget.value)}
        />
        <select
          class="currency-amount__select"
          aria-label={`${label} currency`}
          value={currencyId}
          onChange={(event) => onCurrencyChange(event.currentTarget.value)}
        >
          <CurrencyOptions currencies={currencies} />
        </select>
      </div>
      {error && (
        <p id={errorId} class="currency-amount__error">
          {error}
        </p>
      )}
    </div>
  );
}
