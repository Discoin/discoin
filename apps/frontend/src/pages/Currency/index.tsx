import { useRoute } from "preact-iso";
import { api } from "../../api/client.js";
import { ApiError } from "../../api/errors.js";
import type { Currency, HistoryDays, Transaction } from "../../api/types.js";
import "../../components/currency/CurrencyTag.scss";
import { EmptyState } from "../../components/shared/EmptyState.jsx";
import { TradeableCalculator } from "../../components/currency/TradeableCalculator.jsx";
import { Liquidity } from "../../components/currency/Liquidity.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { Panel } from "../../components/layout/Panel.jsx";
import { PriceChange } from "../../components/currency/PriceChange.jsx";
import { StatList } from "../../components/shared/StatList.jsx";
import { TransactionTable } from "../../components/transactions/TransactionTable.jsx";
import { activeCurrencies } from "../../lib/currencies.js";
import { currencyValue } from "../../lib/exchange.js";
import { formatValue } from "../../lib/format.js";
import { usePageTitle } from "../../lib/usePageTitle.js";
import { useRequest, type RequestState } from "../../lib/useRequest.js";
import {
  changeOver,
  highest,
  lastDays,
  lowest,
  valuePoints,
  type ValuePoint,
} from "../../lib/valueStats.js";
import { ValueChart } from "./ValueChart.jsx";
import "./style.scss";

const WEEK_DAYS = 7;
const MONTH_DAYS: HistoryDays = 30;

interface CurrencyPageData {
  currency: Currency;
  currencies: Currency[];
  points: ValuePoint[];
  transactions: Transaction[];
}

async function loadCurrencyPage(
  abbreviation: string,
): Promise<CurrencyPageData> {
  const currency = await api.getCurrency(abbreviation);
  const [currencies, history, transactions] = await Promise.all([
    api.listAllCurrencies(),
    api.getReserveHistory(currency.id, MONTH_DAYS),
    api.listCurrencyTransactions(currency.id),
  ]);

  return { currency, currencies, points: valuePoints(history), transactions };
}

function useAbbreviation(): string {
  const { params } = useRoute();
  const abbreviation = params.abbreviation;
  if (abbreviation === undefined) {
    throw new Error("The currency route needs an abbreviation");
  }

  return abbreviation.toUpperCase();
}

function titleOf(
  state: RequestState<CurrencyPageData>,
  abbreviation: string,
): string {
  if (state.status !== "ready") return abbreviation;

  const { name } = state.data.currency;

  return `${name} (${abbreviation})`;
}

function isMissing(state: RequestState<CurrencyPageData>): boolean {
  return (
    state.status === "failed" &&
    state.error instanceof ApiError &&
    state.error.status === 404
  );
}

export function CurrencyPage() {
  const abbreviation = useAbbreviation();
  const request = useRequest(
    () => loadCurrencyPage(abbreviation),
    [abbreviation],
  );
  usePageTitle(titleOf(request.state, abbreviation));

  if (isMissing(request.state)) {
    return <MissingCurrency abbreviation={abbreviation} />;
  }

  return (
    <div class="page">
      <Loadable
        state={request.state}
        label={abbreviation}
        onRetry={request.reload}
      >
        {(data) => <CurrencyView {...data} />}
      </Loadable>
    </div>
  );
}

function MissingCurrency({ abbreviation }: { abbreviation: string }) {
  return (
    <div class="page">
      <h1 class="quote__name">{abbreviation}</h1>
      <EmptyState title={`No currency called ${abbreviation}`}>
        <p>It may have been renamed. Pick one from the dashboard instead.</p>
        <a href="/">Back to the dashboard</a>
      </EmptyState>
    </div>
  );
}

function CurrencyView({
  currency,
  currencies,
  points,
  transactions,
}: CurrencyPageData) {
  const month = lastDays(points, MONTH_DAYS);
  const { abbreviation } = currency;

  return (
    <>
      <div class="quote">
        <h1 class="quote__name">
          {currency.name}{" "}
          <span class="currency-tag__code figure">{abbreviation}</span>
          {!currency.active && <span class="quote__inactive">Inactive</span>}
        </h1>
        <p class="quote__price">
          <span class="quote__value figure">
            {formatValue(currencyValue(currency.reserve))}
          </span>
          <span class="quote__change">
            <PriceChange change={currency.change24h} /> today
          </span>
        </p>
      </div>
      <Panel id="chart" title={`${abbreviation} value`}>
        <ValueChart currency={currency} points={points} />
      </Panel>
      <Panel
        id="stats"
        title="Key stats"
        description={`Liquidity is how much ${abbreviation} Discoin holds. More liquidity means big trades move the value less.`}
      >
        <StatList
          stats={[
            {
              label: "Liquidity",
              value: (
                <Liquidity
                  amount={currency.reserve}
                  abbreviation={abbreviation}
                />
              ),
            },
            {
              label: "24h change",
              value: <PriceChange change={currency.change24h} />,
            },
            {
              label: "7d change",
              value: (
                <PriceChange change={changeOver(lastDays(points, WEEK_DAYS))} />
              ),
            },
            { label: "30d high", value: formatValue(highest(month)) },
            { label: "30d low", value: formatValue(lowest(month)) },
          ]}
        />
      </Panel>
      <Panel id="trade" title={`Trade ${abbreviation}`}>
        <div class="quote__calculator">
          {currency.active ? (
            <TradeableCalculator
              currencies={activeCurrencies(currencies)}
              initialFromId={currency.id}
            />
          ) : (
            <EmptyState title="Trading is paused">
              <p>
                {abbreviation} is inactive, so it can't be converted right now.
                Its history stays here.
              </p>
            </EmptyState>
          )}
        </div>
      </Panel>
      <Panel id="trades" title={`Recent ${abbreviation} trades`}>
        {transactions.length === 0 ? (
          <EmptyState title="No trades yet">
            <p>Trades into or out of {abbreviation} show up here.</p>
          </EmptyState>
        ) : (
          <TransactionTable
            caption={`Recent ${abbreviation} trades`}
            transactions={transactions}
            currencies={currencies}
          />
        )}
      </Panel>
    </>
  );
}
