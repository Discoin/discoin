export const WORTH_IN_DISCOIN = 100_000;

const CENTS = 100;
const FLOAT_NOISE_DIGITS = 6;

export interface ExchangeReserves {
  from: number;
  to: number;
}

export function currencyValue(reserve: number): number {
  return WORTH_IN_DISCOIN / reserve;
}

export function marketRate(reserves: ExchangeReserves): number {
  return reserves.to / reserves.from;
}

function toCentUnits(amount: number): number {
  return Number((amount * CENTS).toFixed(FLOAT_NOISE_DIGITS));
}

export function floorToCents(amount: number): number {
  return Math.floor(toCentUnits(amount)) / CENTS;
}

export function ceilToCents(amount: number): number {
  return Math.ceil(toCentUnits(amount)) / CENTS;
}

export function calculatePayout(
  amount: number,
  reserves: ExchangeReserves,
): number {
  return floorToCents((reserves.to * amount) / (reserves.from + amount));
}

export function reservesAfterUndo(
  payout: number,
  reserves: ExchangeReserves,
): ExchangeReserves {
  const giveBack = calculatePayout(payout, {
    from: reserves.to,
    to: reserves.from,
  });

  return {
    from: floorToCents(reserves.from - giveBack),
    to: floorToCents(reserves.to + payout),
  };
}

export function calculateRequiredAmount(
  payout: number,
  reserves: ExchangeReserves,
): number {
  if (payout >= reserves.to) {
    throw new RangeError(
      `A payout of ${payout} can't be reached: it must stay below the reserve of ${reserves.to}`,
    );
  }

  return ceilToCents((reserves.from * payout) / (reserves.to - payout));
}

export function startingReserve(
  weeklyMedian: number,
  multiplier: number,
): number {
  return floorToCents(weeklyMedian * multiplier);
}
