import { render, screen } from "@testing-library/preact";
import { expect, test } from "vitest";

import { PriceChange } from "./PriceChange.jsx";

test.each([
  [0.021, "price-change--up", "+2.1%"],
  [-0.004, "price-change--down", "−0.4%"],
  [0, "price-change--flat", "0.0%"],
])(
  "shows %s with direction class and signed text",
  (change, directionClass, text) => {
    render(<PriceChange change={change} />);

    const element = screen.getByText(text);

    expect(element.className).toContain(directionClass);
  },
);
