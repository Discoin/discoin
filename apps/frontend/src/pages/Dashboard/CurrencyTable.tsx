import type { Currency } from "../../api/types.js";
import { TableFrame } from "../../components/shared/TableFrame.jsx";
import { currencyValue } from "../../lib/exchange.js";
import { formatValue } from "../../lib/format.js";
import { Liquidity } from "../../components/currency/Liquidity.jsx";
import { CurrencyLink } from "./CurrencyLink.jsx";
import { PriceChange } from "../../components/currency/PriceChange.jsx";
import { Sparkline } from "./Sparkline.jsx";
import "../../components/shared/DataTable.scss";

export function CurrencyTable({ currencies }: { currencies: Currency[] }) {
  return (
    <TableFrame label="Currencies">
      <table class="data-table">
        <caption class="visually-hidden">Currencies</caption>
        <thead>
          <tr>
            <th scope="col">Currency</th>
            <th scope="col" class="data-table__number">
              Value
            </th>
            <th scope="col" class="data-table__number">
              24h
            </th>
            <th scope="col" class="data-table__number">
              Liquidity
            </th>
            <th scope="col">7 days</th>
          </tr>
        </thead>
        <tbody>
          {currencies.map((currency) => (
            <tr key={currency.id}>
              <td>
                <CurrencyLink currency={currency} />
              </td>
              <td class="data-table__number">
                {formatValue(currencyValue(currency.reserve))}
              </td>
              <td class="data-table__number">
                <PriceChange change={currency.change24h} />
              </td>
              <td class="data-table__number">
                <Liquidity
                  amount={currency.reserve}
                  abbreviation={currency.abbreviation}
                />
              </td>
              <td class="data-table__graphic">
                <Sparkline
                  values={currency.valueHistory}
                  label={`${currency.name} value over 7 days`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
