const TARGET_INTERVALS = 3;
const NICE_STEPS = [1, 2, 5, 10];

function niceStep(rawStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = NICE_STEPS.find((nice) => nice * magnitude >= rawStep);
  if (step === undefined) {
    throw new RangeError(`No nice step for ${rawStep}`);
  }

  return step * magnitude;
}

function flatTicks(value: number): number[] {
  if (value === 0) return [-1, 0, 1];

  const spread = Math.abs(value) * 0.1;

  return niceTicks(value - spread, value + spread);
}

export function niceTicks(min: number, max: number): number[] {
  if (min > max) throw new RangeError(`min ${min} is above max ${max}`);
  if (min === max) return flatTicks(min);

  const step = niceStep((max - min) / TARGET_INTERVALS);
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  const count = last - first + 1;

  return Array.from({ length: count }, (_, index) =>
    Number(((first + index) * step).toPrecision(12)),
  );
}
