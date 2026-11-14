import { api } from "../../api/client.js";
import type { Currency } from "../../api/types.js";
import { CurrencyTable } from "./CurrencyTable.jsx";
import { TradeableCalculator } from "../../components/currency/TradeableCalculator.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { PageIntro } from "../../components/layout/PageIntro.jsx";
import { Panel } from "../../components/layout/Panel.jsx";
import { TransactionTable } from "../../components/transactions/TransactionTable.jsx";
import { activeCurrencies } from "../../lib/currencies.js";
import { usePageTitle } from "../../lib/usePageTitle.js";
import { useRequest } from "../../lib/useRequest.js";
import "./style.scss";

function isEmpty<T>(list: T[]): boolean {
  return list.length === 0;
}

function RecentTransactions({ currencies }: { currencies: Currency[] }) {
  const transactions = useRequest(() => api.listRecentTransactions(), []);

  return (
    <Loadable
      state={transactions.state}
      label="recent transactions"
      onRetry={transactions.reload}
      empty={{
        when: isEmpty,
        title: "No transactions yet",
        body: <p>Trades between currencies show up here as they happen.</p>,
      }}
    >
      {(list) => (
        <TransactionTable
          caption="Recent transactions"
          transactions={list}
          currencies={currencies}
        />
      )}
    </Loadable>
  );
}

function Market({ currencies }: { currencies: Currency[] }) {
  const active = activeCurrencies(currencies);

  return (
    <>
      <Panel
        id="currencies"
        title="Currencies"
        description="Each value works like a stock price: trades move it, and it drops as the currency's liquidity grows. Pick a currency to see its page."
      >
        <CurrencyTable currencies={active} />
      </Panel>
      <Panel
        id="calculator"
        title="Exchange calculator"
        description="Type in either box. The payout follows the bonding curve, so it shows what a trade of that size gets right now."
      >
        <div class="dashboard__calculator">
          <TradeableCalculator currencies={active} />
        </div>
      </Panel>
      <Panel
        id="recent"
        title="Recent transactions"
        description="Every trade through Discoin. User IDs stay private."
      >
        <RecentTransactions currencies={currencies} />
      </Panel>
    </>
  );
}

export function Dashboard() {
  usePageTitle(undefined);
  const currencies = useRequest(() => api.listAllCurrencies(), []);

  return (
    <div class="page">
      <PageIntro title="Discoin exchange">
        Trade between Discord bot currencies. Each coin's value comes from how
        much of it Discoin holds.
      </PageIntro>
      <Loadable
        state={currencies.state}
        label="currencies"
        onRetry={currencies.reload}
        empty={{
          when: (list) => isEmpty(activeCurrencies(list)),
          title: "No currencies yet",
          body: <p>Currencies show up here once an admin adds them.</p>,
        }}
      >
        {(list) => <Market currencies={list} />}
      </Loadable>
    </div>
  );
}
