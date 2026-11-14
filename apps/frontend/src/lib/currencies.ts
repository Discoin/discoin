import type { Currency } from "../api/types.js";

export function activeCurrencies(currencies: Currency[]): Currency[] {
  return currencies.filter((currency) => currency.active);
}

export function findCurrency(currencies: Currency[], id: string): Currency {
  const currency = currencies.find((candidate) => candidate.id === id);
  if (currency === undefined) {
    throw new Error(`Unknown currency "${id}"`);
  }

  return currency;
}
