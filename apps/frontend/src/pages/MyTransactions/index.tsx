import { api } from "../../api/client.js";
import { RequireLogin } from "../../components/session/RequireLogin.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { PageIntro } from "../../components/layout/PageIntro.jsx";
import { TransactionTable } from "../../components/transactions/TransactionTable.jsx";
import { usePageTitle } from "../../lib/usePageTitle.js";
import { useRequest } from "../../lib/useRequest.js";
import "../../components/layout/Panel.scss";

async function loadMyTransactions() {
  const [currencies, transactions] = await Promise.all([
    api.listAllCurrencies(),
    api.listMyTransactions(),
  ]);

  return { currencies, transactions };
}

function MyTransactionList() {
  const request = useRequest(loadMyTransactions, []);

  return (
    <Loadable
      state={request.state}
      label="your transactions"
      onRetry={request.reload}
      empty={{
        when: (data) => data.transactions.length === 0,
        title: "No transactions yet",
        body: (
          <p>
            Use a Discoin command in a bot that supports it, and the trade shows
            up here.
          </p>
        ),
      }}
    >
      {(data) => (
        <TransactionTable
          caption="My transactions"
          transactions={data.transactions}
          currencies={data.currencies}
        />
      )}
    </Loadable>
  );
}

export function MyTransactions() {
  usePageTitle("My transactions");

  return (
    <div class="page">
      <PageIntro title="My transactions">
        Every trade you made through a Discoin bot, newest first. Pending means
        the bot receiving the coins hasn't confirmed it yet.
      </PageIntro>
      <RequireLogin access="user">{() => <MyTransactionList />}</RequireLogin>
    </div>
  );
}
