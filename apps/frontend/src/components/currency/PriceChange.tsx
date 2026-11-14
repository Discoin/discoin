import { directionOf, type Direction } from "../../lib/direction.js";
import { formatChange } from "../../lib/format.js";
import "./PriceChange.scss";

const GLYPHS: Record<Direction, string> = {
  up: "▲",
  down: "▼",
  flat: "◆",
};

export function PriceChange({ change }: { change: number }) {
  const direction = directionOf(change);

  return (
    <span class={`price-change price-change--${direction} figure`}>
      <span class="price-change__glyph" aria-hidden="true">
        {GLYPHS[direction]}
      </span>
      {formatChange(change)}
    </span>
  );
}
