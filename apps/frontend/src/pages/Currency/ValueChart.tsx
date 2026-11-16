import { useState } from "preact/hooks";
import type { Currency } from "../../api/types.js";
import { EmptyState } from "../../components/shared/EmptyState.jsx";
import { LineChart } from "../../components/shared/LineChart.jsx";
import { formatAxisValues, formatValue } from "../../lib/format.js";
import { lastDays, type ValuePoint } from "../../lib/valueStats.js";

const CHART_RANGES = [
  { days: 7, label: "7D", name: "7 days" },
  { days: 30, label: "30D", name: "30 days" },
] as const;

type ChartRange = (typeof CHART_RANGES)[number];

interface ValueChartProps {
  currency: Currency;
  points: ValuePoint[];
}

export function ValueChart({ currency, points }: ValueChartProps) {
  const [range, setRange] = useState<ChartRange>(CHART_RANGES[1]);
  const shown = lastDays(points, range.days);

  return (
    <div class="value-chart">
      <div class="value-chart__ranges" role="group" aria-label="Chart range">
        {CHART_RANGES.map((option) => (
          <button
            key={option.days}
            type="button"
            class="value-chart__range"
            aria-pressed={option.days === range.days}
            onClick={() => setRange(option)}
          >
            {option.label}
            <span class="visually-hidden"> ({option.name})</span>
          </button>
        ))}
      </div>
      {shown.length < 2 ? (
        <EmptyState title="Not enough history yet">
          <p>
            {currency.abbreviation} is new. Its chart starts once it has a
            second day of trading.
          </p>
        </EmptyState>
      ) : (
        <LineChart
          title={`${currency.abbreviation} value, last ${range.name}`}
          tone="value"
          points={shown}
          format={formatValue}
          formatAxis={formatAxisValues}
        />
      )}
    </div>
  );
}
