import { useMemo, useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { Currency } from "../../api/types.js";
import { BlockedUsers } from "../../components/blocking/BlockedUsers.jsx";
import { RequireLogin } from "../../components/session/RequireLogin.jsx";
import { CurrencyOptions } from "../../components/currency/CurrencyOptions.jsx";
import { Liquidity } from "../../components/currency/Liquidity.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { PageIntro } from "../../components/layout/PageIntro.jsx";
import { Panel } from "../../components/layout/Panel.jsx";
import { PriceChange } from "../../components/currency/PriceChange.jsx";
import { Select } from "../../components/shared/Select.jsx";
import { StatList } from "../../components/shared/StatList.jsx";
import { findCurrency } from "../../lib/currencies.js";
import { currencyValue } from "../../lib/exchange.js";
import { formatValue } from "../../lib/format.js";
import { usePageTitle } from "../../lib/usePageTitle.js";
import { useRequest } from "../../lib/useRequest.js";
import { ApiToken } from "./ApiToken.jsx";
import { DailyCapForm } from "./DailyCapForm.jsx";
import { DetailsForm } from "./DetailsForm.jsx";
import { PendingWebhooks } from "./PendingWebhooks.jsx";
import { WebhookForm } from "./WebhookForm.jsx";

function replaced(currencies: Currency[], updated: Currency): Currency[] {
  return currencies.map((currency) =>
    currency.id === updated.id ? updated : currency,
  );
}

async function loadCurrencyWorkspace(currencyId: string) {
  const [settings, pending, currencies] = await Promise.all([
    api.getCurrencySettings(currencyId),
    api.listPendingTransactions(currencyId),
    api.listAllCurrencies(),
  ]);

  return { settings, pending, currencies };
}

interface OwnedCurrencyProps {
  currency: Currency;
  onSaved: (currency: Currency) => void;
}

function OwnedCurrency({ currency, onSaved }: OwnedCurrencyProps) {
  const request = useRequest(
    () => loadCurrencyWorkspace(currency.id),
    [currency.id],
  );
  const blockList = useMemo(
    () => api.currencyBlocks(currency.id),
    [currency.id],
  );

  return (
    <Loadable
      state={request.state}
      label={`${currency.name} settings`}
      onRetry={request.reload}
    >
      {({ settings, pending, currencies }) => (
        <>
          <div class="page__columns">
            <Panel id="details" title="Name and abbreviation">
              <DetailsForm currency={currency} onSaved={onSaved} />
            </Panel>
            <Panel
              id="token"
              title="API token"
              description="Your bot sends this with every request. Keep it secret."
            >
              <ApiToken
                currencyId={currency.id}
                hasToken={settings.hasApiToken}
              />
            </Panel>
          </div>
          <div class="page__columns">
            <Panel
              id="market"
              title="Value and liquidity"
              description="Set by trades on the bonding curve. Only an admin can reset the liquidity."
            >
              <StatList
                stats={[
                  {
                    label: `${currency.abbreviation} value`,
                    value: formatValue(currencyValue(currency.reserve)),
                  },
                  {
                    label: "Liquidity",
                    value: (
                      <Liquidity
                        amount={currency.reserve}
                        abbreviation={currency.abbreviation}
                      />
                    ),
                  },
                  {
                    label: "24h",
                    value: <PriceChange change={currency.change24h} />,
                  },
                ]}
              />
            </Panel>
            <Panel
              id="cap"
              title="Daily cap"
              description="The most one user can receive in this currency over 24 hours."
            >
              <DailyCapForm
                currency={currency}
                initialCap={settings.dailyCap}
              />
            </Panel>
          </div>
          <Panel
            id="webhook"
            title="Webhook"
            description="Get a receipt the moment a transaction comes in, instead of polling."
          >
            <WebhookForm
              currencyId={currency.id}
              initialUrl={settings.webhookUrl}
              hasSecret={settings.hasWebhookSecret}
            />
          </Panel>
          <Panel
            id="pending"
            title="Pending transactions"
            description="Transactions into your currency that your bot hasn't marked Completed or Refunded yet."
          >
            <PendingWebhooks pending={pending} currencies={currencies} />
          </Panel>
          <Panel
            id="blocked"
            title="Blocked users"
            description={`Blocked users can't trade into or out of ${currency.abbreviation}. Blocking cancels their Pending transactions.`}
          >
            <BlockedUsers
              blockList={blockList}
              scope={`from ${currency.abbreviation}`}
            />
          </Panel>
        </>
      )}
    </Loadable>
  );
}

interface OwnerWorkspaceProps {
  currencies: Currency[];
  onSaved: (currency: Currency) => void;
}

function OwnerWorkspace({ currencies, onSaved }: OwnerWorkspaceProps) {
  const [currencyId, setCurrencyId] = useState(currencies[0].id);
  const currency = findCurrency(currencies, currencyId);

  return (
    <>
      {currencies.length > 1 && (
        <div class="picker">
          <Select
            label="Currency"
            value={currencyId}
            onChange={(event) => setCurrencyId(event.currentTarget.value)}
          >
            <CurrencyOptions currencies={currencies} />
          </Select>
        </div>
      )}
      <OwnedCurrency key={currencyId} currency={currency} onSaved={onSaved} />
    </>
  );
}

function OwnedCurrencies() {
  const owned = useRequest(() => api.listOwnedCurrencies(), []);

  function save(updated: Currency) {
    if (owned.state.status !== "ready") {
      throw new Error("Saved a currency before the owned list loaded");
    }

    owned.update(replaced(owned.state.data, updated));
  }

  return (
    <Loadable
      state={owned.state}
      label="your currencies"
      onRetry={owned.reload}
      empty={{
        when: (list) => list.length === 0,
        title: "You don't own a currency yet",
        body: <p>Ask a Discoin admin to add your bot's currency.</p>,
      }}
    >
      {(currencies) => (
        <OwnerWorkspace currencies={currencies} onSaved={save} />
      )}
    </Loadable>
  );
}

export function BotOwner() {
  usePageTitle("Bot owner");

  return (
    <div class="page">
      <PageIntro title="Bot owner">
        Settings for the currencies your bots run. Changes here apply to every
        bot that uses the token.
      </PageIntro>
      <RequireLogin access="user">{() => <OwnedCurrencies />}</RequireLogin>
    </div>
  );
}
