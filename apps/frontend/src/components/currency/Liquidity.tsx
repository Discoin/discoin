import { formatAmount, formatLiquidity } from "../../lib/format.js";

interface LiquidityProps {
  amount: number;
  abbreviation: string;
}

export function Liquidity({ amount, abbreviation }: LiquidityProps) {
  const exact = `${formatAmount(amount)} ${abbreviation}`;

  return (
    <span class="liquidity" title={exact}>
      <span aria-hidden="true">
        {formatLiquidity(amount)} {abbreviation}
      </span>
      <span class="visually-hidden">{exact}</span>
    </span>
  );
}
