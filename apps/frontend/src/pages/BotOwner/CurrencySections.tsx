import { api } from "../../api/client.js";
import type { Currency } from "../../api/types.js";
import { Liquidity } from "../../components/currency/Liquidity.jsx";
import { PriceChange } from "../../components/currency/PriceChange.jsx";
import { Panel } from "../../components/layout/Panel.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { StatList } from "../../components/shared/StatList.jsx";
import { currencyValue } from "../../lib/exchange.js";
import { formatValue } from "../../lib/format.js";
import { useRequest } from "../../lib/useRequest.js";
import { DailyCapForm } from "./DailyCapForm.jsx";
import { DetailsForm } from "./DetailsForm.jsx";

interface CurrencySectionsProps {
  currency: Currency;
  onCurrencyChanged: (currency: Currency) => void;
}

export function CurrencySections({
  currency,
  onCurrencyChanged,
}: CurrencySectionsProps) {
  const settings = useRequest(
    () => api.getCurrencySettings(currency.id),
    [currency.id],
  );
  const markDeactivated = () =>
    onCurrencyChanged({ ...currency, active: false });

  return (
    <div class="page__columns">
      <Panel id="details" level={3} title="Name and abbreviation">
        <DetailsForm
          currency={currency}
          onSaved={onCurrencyChanged}
          onDeactivated={markDeactivated}
        />
      </Panel>
      <Panel
        id="market"
        level={3}
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
        level={3}
        title="Daily cap"
        description="The most one user can receive in this currency over 24 hours."
      >
        <Loadable
          state={settings.state}
          label="the daily cap"
          onRetry={settings.reload}
        >
          {(loaded) => (
            <DailyCapForm
              currency={currency}
              initialCap={loaded.dailyCap}
              onDeactivated={markDeactivated}
            />
          )}
        </Loadable>
      </Panel>
    </div>
  );
}
