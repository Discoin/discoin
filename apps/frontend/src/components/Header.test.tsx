import { render, screen } from "@testing-library/preact";
import { LocationProvider } from "preact-iso";
import { expect, test } from "vitest";

import { Header } from "./Header.jsx";

test("marks only the link of the current route as active", () => {
  render(
    <LocationProvider>
      <Header />
    </LocationProvider>,
  );

  expect(screen.getByRole("link", { name: "Home" }).className).toBe("active");
  expect(screen.getByRole("link", { name: "404" }).className).toBe("");
});
