import type { Currency } from "../../api/types.js";
import { EmptyState } from "../shared/EmptyState.jsx";
import { ExchangeCalculator } from "./ExchangeCalculator.jsx";

const PAIR = 2;

interface TradeableCalculatorProps {
  currencies: Currency[];
  initialFromId?: string;
}

export function TradeableCalculator({
  currencies,
  initialFromId,
}: TradeableCalculatorProps) {
  if (currencies.length < PAIR) {
    return (
      <EmptyState title="Not enough currencies to trade">
        <p>The calculator needs at least two active currencies.</p>
      </EmptyState>
    );
  }

  return (
    <ExchangeCalculator currencies={currencies} initialFromId={initialFromId} />
  );
}
