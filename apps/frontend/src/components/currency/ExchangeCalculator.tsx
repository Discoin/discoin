import { useState } from "preact/hooks";
import type { Currency } from "../../api/types.js";
import { convert, type ConverterSide } from "../../lib/converter.js";
import { findCurrency } from "../../lib/currencies.js";
import { marketRate } from "../../lib/exchange.js";
import { formatValue } from "../../lib/format.js";
import { CurrencyAmountField } from "./CurrencyAmountField.jsx";
import "./ExchangeCalculator.scss";

interface CalculatorState {
  fromId: string;
  toId: string;
  edited: ConverterSide;
  text: string;
}

function withCurrency(
  state: CalculatorState,
  side: ConverterSide,
  currencyId: string,
): CalculatorState {
  const otherId = side === "send" ? state.toId : state.fromId;
  if (currencyId === otherId) return swapped(state);

  return side === "send"
    ? { ...state, fromId: currencyId }
    : { ...state, toId: currencyId };
}

function swapped(state: CalculatorState): CalculatorState {
  return {
    fromId: state.toId,
    toId: state.fromId,
    edited: state.edited === "send" ? "receive" : "send",
    text: state.text,
  };
}

interface ExchangeCalculatorProps {
  currencies: Currency[];
  initialFromId?: string;
}

function firstOtherId(currencies: Currency[], id: string): string {
  const other = currencies.find((currency) => currency.id !== id);
  if (other === undefined) {
    throw new RangeError("The calculator needs at least two currencies");
  }

  return other.id;
}

export function ExchangeCalculator({
  currencies,
  initialFromId = currencies[0].id,
}: ExchangeCalculatorProps) {
  const [state, setState] = useState<CalculatorState>({
    fromId: initialFromId,
    toId: firstOtherId(currencies, initialFromId),
    edited: "send",
    text: "1000",
  });

  const from = findCurrency(currencies, state.fromId);
  const to = findCurrency(currencies, state.toId);
  const conversion = convert({
    from,
    to,
    edited: state.edited,
    text: state.text,
  });
  const rate = marketRate({ from: from.reserve, to: to.reserve });

  function errorFor(side: ConverterSide): string | undefined {
    return conversion.error?.side === side
      ? conversion.error.message
      : undefined;
  }

  return (
    <form
      class="exchange-calculator"
      onSubmit={(event) => event.preventDefault()}
    >
      <div class="exchange-calculator__fields">
        <CurrencyAmountField
          label="You send"
          amountText={conversion.sendText}
          currencyId={state.fromId}
          currencies={currencies}
          error={errorFor("send")}
          onAmountInput={(text) => setState({ ...state, edited: "send", text })}
          onCurrencyChange={(id) => setState(withCurrency(state, "send", id))}
        />
        <button
          type="button"
          class="exchange-calculator__swap"
          aria-label="Swap currencies"
          title="Swap currencies"
          onClick={() => setState(swapped(state))}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            class="exchange-calculator__swap-icon"
          >
            <path d="M4 8h14l-4-4M20 16H6l4 4" />
          </svg>
        </button>
        <CurrencyAmountField
          label="They receive"
          amountText={conversion.receiveText}
          currencyId={state.toId}
          currencies={currencies}
          error={errorFor("receive")}
          onAmountInput={(text) =>
            setState({ ...state, edited: "receive", text })
          }
          onCurrencyChange={(id) =>
            setState(withCurrency(state, "receive", id))
          }
        />
      </div>
      <div class="exchange-calculator__rates" aria-live="polite">
        <p class="exchange-calculator__market figure">
          1 {from.abbreviation} = {formatValue(rate)} {to.abbreviation}
        </p>
        {conversion.effectiveRate !== undefined && (
          <p class="exchange-calculator__effective">
            This amount gets{" "}
            <span class="figure">
              {formatValue(conversion.effectiveRate)} {to.abbreviation}
            </span>{" "}
            per {from.abbreviation}. Bigger trades get less per coin, because
            each trade moves the price.
          </p>
        )}
      </div>
    </form>
  );
}
