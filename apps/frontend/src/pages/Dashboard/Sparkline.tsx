import { directionOf, type Direction } from "../../lib/direction.js";
import "./Sparkline.scss";

const WIDTH = 96;
const HEIGHT = 28;
const PADDING = 2;

const TREND_WORDS: Record<Direction, string> = {
  up: "trending up",
  down: "trending down",
  flat: "unchanged",
};

interface SparklineProps {
  values: number[];
  label: string;
}

function toPoints(values: number[]): [number, number][] {
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const step = (WIDTH - PADDING * 2) / (values.length - 1);
  const usableHeight = HEIGHT - PADDING * 2;

  return values.map((value, index) => {
    const ratio = range === 0 ? 0.5 : (value - min) / range;

    return [PADDING + index * step, PADDING + (1 - ratio) * usableHeight];
  });
}

export function Sparkline({ values, label }: SparklineProps) {
  if (values.length < 2) {
    throw new RangeError("Sparkline needs at least two values");
  }

  const points = toPoints(values);
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  const area = `${PADDING},${HEIGHT} ${line} ${lastX},${HEIGHT}`;
  const direction = directionOf(values[values.length - 1] - values[0]);

  return (
    <svg
      class={`sparkline sparkline--${direction}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={`${label}, ${TREND_WORDS[direction]}`}
    >
      <polygon class="sparkline__area" points={area} />
      <polyline class="sparkline__line" points={line} />
      <circle class="sparkline__end" cx={lastX} cy={lastY} r="2.5" />
    </svg>
  );
}
