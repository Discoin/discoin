import { useState } from "preact/hooks";
import type { Currency } from "../../api/types.js";
import { currencyPath } from "../../lib/currencyPath.js";
import { currencyValue } from "../../lib/exchange.js";
import { formatValue } from "../../lib/format.js";
import { PriceChange } from "../currency/PriceChange.jsx";
import "./Ticker.scss";

const MIN_ITEMS_PER_HALF = 16;
const SECONDS_PER_ITEM = 8;

interface TickerItemProps {
  currency: Currency;
  linkTabIndex?: number;
}

function TickerItem({ currency, linkTabIndex }: TickerItemProps) {
  return (
    <li class="ticker__item">
      <a
        class="ticker__link"
        href={currencyPath(currency.abbreviation)}
        tabIndex={linkTabIndex}
      >
        <span class="ticker__code">{currency.abbreviation}</span>
        <span class="ticker__value">
          {formatValue(currencyValue(currency.reserve))}
        </span>
        <PriceChange change={currency.change24h} />
      </a>
    </li>
  );
}

function repeatToFill(currencies: Currency[]): Currency[] {
  const repeats = Math.ceil(MIN_ITEMS_PER_HALF / currencies.length);

  return Array.from({ length: repeats }, () => currencies).flat();
}

function TickerHalf({ items }: { items: Currency[] }) {
  return (
    <ul class="ticker__list">
      {items.map((currency, index) => (
        <TickerItem
          key={`${index}-${currency.id}`}
          currency={currency}
          linkTabIndex={-1}
        />
      ))}
    </ul>
  );
}

export function Ticker({ currencies }: { currencies: Currency[] }) {
  if (currencies.length === 0) {
    throw new RangeError("Ticker needs at least one currency");
  }

  const [paused, setPaused] = useState(false);
  const half = repeatToFill(currencies);
  const duration = `${half.length * SECONDS_PER_ITEM}s`;

  return (
    <section
      class={paused ? "ticker ticker--paused" : "ticker"}
      aria-label="Currency values"
    >
      <button
        type="button"
        class="ticker__toggle"
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
      >
        <TickerToggleIcon paused={paused} />
        <span class="visually-hidden">Pause ticker</span>
      </button>
      <ul class="ticker__list ticker__static">
        {currencies.map((currency) => (
          <TickerItem key={currency.id} currency={currency} />
        ))}
      </ul>
      <div class="ticker__viewport">
        <div
          class="ticker__track"
          aria-hidden="true"
          style={{ animationDuration: duration }}
        >
          <TickerHalf items={half} />
          <TickerHalf items={half} />
        </div>
      </div>
    </section>
  );
}

function TickerToggleIcon({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {paused ? (
        <path d="M4 2.5v11l9-5.5z" />
      ) : (
        <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" />
      )}
    </svg>
  );
}
