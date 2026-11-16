import { useState } from "preact/hooks";
import { TableFrame } from "./TableFrame.jsx";
import { formatShortDate } from "../../lib/format.js";
import { niceTicks } from "../../lib/ticks.js";
import { useElementWidth } from "../../lib/useElementWidth.js";
import "./DataTable.scss";
import "./LineChart.scss";

const HEIGHT = 200;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 72 };
const AXIS_LABEL_GAP = 8;
const X_LABEL_COUNT = 3;
const TOOLTIP_HALF_WIDTH = 56;

export interface ChartPoint {
  at: string;
  value: number;
}

export type ChartTone = "value" | "reserve";

interface LineChartProps {
  title: string;
  points: ChartPoint[];
  tone: ChartTone;
  format: (value: number) => string;
  formatAxis: (ticks: number[]) => string[];
}

interface Scales {
  x: (index: number) => number;
  y: (value: number) => number;
  ticks: number[];
  plotWidth: number;
}

function buildScales(points: ChartPoint[], width: number): Scales {
  const values = points.map((point) => point.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const lastIndex = points.length - 1;

  return {
    x: (index) => MARGIN.left + (index / lastIndex) * plotWidth,
    y: (value) => MARGIN.top + (1 - (value - low) / (high - low)) * plotHeight,
    ticks,
    plotWidth,
  };
}

function xLabelIndexes(pointCount: number): number[] {
  const lastIndex = pointCount - 1;
  const steps = X_LABEL_COUNT - 1;

  return Array.from({ length: X_LABEL_COUNT }, (_, step) =>
    Math.round((step / steps) * lastIndex),
  );
}

function dateAnchor(index: number, lastIndex: number): string {
  if (index === 0) return "start";
  if (index === lastIndex) return "end";

  return "middle";
}

function tooltipLeft(x: number, width: number): number {
  return Math.min(Math.max(x, TOOLTIP_HALF_WIDTH), width - TOOLTIP_HALF_WIDTH);
}

function summary(
  title: string,
  points: ChartPoint[],
  format: LineChartProps["format"],
) {
  const first = points[0];
  const last = points[points.length - 1];

  return `${title}: ${format(first.value)} on ${formatShortDate(first.at)}, ${format(last.value)} on ${formatShortDate(last.at)}`;
}

export function LineChart({
  title,
  points,
  tone,
  format,
  formatAxis,
}: LineChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  if (points.length < 2) {
    throw new RangeError("LineChart needs at least two points");
  }

  return (
    <figure class={`line-chart line-chart--${tone}`}>
      <figcaption class="line-chart__title">{title}</figcaption>
      <div class="line-chart__frame" ref={ref}>
        {width !== undefined && (
          <Plot
            points={points}
            width={width}
            format={format}
            formatAxis={formatAxis}
            label={summary(title, points, format)}
          />
        )}
      </div>
      <details class="line-chart__table">
        <summary>Show the numbers</summary>
        <TableFrame label={`${title} by day`}>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" class="data-table__number">
                  {title}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.at}>
                  <td>{formatShortDate(point.at)}</td>
                  <td class="data-table__number">{format(point.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </details>
    </figure>
  );
}

interface PlotProps {
  points: ChartPoint[];
  width: number;
  format: LineChartProps["format"];
  formatAxis: LineChartProps["formatAxis"];
  label: string;
}

function Plot({ points, width, format, formatAxis, label }: PlotProps) {
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const scales = buildScales(points, width);
  const axisLabels = formatAxis(scales.ticks);
  const line = points
    .map((point, index) => `${scales.x(index)},${scales.y(point.value)}`)
    .join(" ");
  const lastIndex = points.length - 1;
  const marked = hovered ?? lastIndex;
  const plotBottom = HEIGHT - MARGIN.bottom;

  function trackPointer(event: PointerEvent) {
    const bounds = (
      event.currentTarget as SVGRectElement
    ).getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    setHovered(Math.round(Math.min(Math.max(ratio, 0), 1) * lastIndex));
  }

  return (
    <div class="line-chart__plot">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={label}
      >
        {scales.ticks.map((tick, index) => (
          <g key={tick} class="line-chart__grid">
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={scales.y(tick)}
              y2={scales.y(tick)}
            />
            <text
              x={MARGIN.left - AXIS_LABEL_GAP}
              y={scales.y(tick)}
              text-anchor="end"
              dominant-baseline="middle"
            >
              {axisLabels[index]}
            </text>
          </g>
        ))}
        {xLabelIndexes(points.length).map((index) => (
          <text
            key={index}
            class="line-chart__date"
            x={scales.x(index)}
            y={HEIGHT - AXIS_LABEL_GAP}
            text-anchor={dateAnchor(index, lastIndex)}
          >
            {formatShortDate(points[index].at)}
          </text>
        ))}
        {hovered !== undefined && (
          <line
            class="line-chart__crosshair"
            x1={scales.x(hovered)}
            x2={scales.x(hovered)}
            y1={MARGIN.top}
            y2={plotBottom}
          />
        )}
        <polyline class="line-chart__line" points={line} />
        <circle
          class="line-chart__dot"
          cx={scales.x(marked)}
          cy={scales.y(points[marked].value)}
          r="4"
        />
        <rect
          class="line-chart__hit"
          x={MARGIN.left}
          y={MARGIN.top}
          width={scales.plotWidth}
          height={plotBottom - MARGIN.top}
          onPointerMove={trackPointer}
          onPointerLeave={() => setHovered(undefined)}
        />
      </svg>
      {hovered !== undefined && (
        <div
          class="line-chart__tooltip"
          aria-hidden="true"
          style={{ left: `${tooltipLeft(scales.x(hovered), width)}px` }}
        >
          <strong class="figure">{format(points[hovered].value)}</strong>
          <span>{formatShortDate(points[hovered].at)}</span>
        </div>
      )}
    </div>
  );
}
