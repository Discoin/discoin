import type { ReservePoint } from "../api/types.js";
import { currencyValue } from "./exchange.js";

const DAY_MS = 86_400_000;

export interface ValuePoint {
  at: string;
  value: number;
}

export function valuePoints(history: ReservePoint[]): ValuePoint[] {
  return history.map((point) => ({
    at: point.at,
    value: currencyValue(point.reserve),
  }));
}

export function lastDays(points: ValuePoint[], days: number): ValuePoint[] {
  if (points.length === 0) throw new RangeError("No history to slice");

  const latest = Date.parse(points[points.length - 1].at);
  const cutoff = latest - days * DAY_MS;

  return points.filter((point) => Date.parse(point.at) >= cutoff);
}

export function changeOver(points: ValuePoint[]): number {
  return points[points.length - 1].value / points[0].value - 1;
}

export function highest(points: ValuePoint[]): number {
  return Math.max(...points.map((point) => point.value));
}

export function lowest(points: ValuePoint[]): number {
  return Math.min(...points.map((point) => point.value));
}
