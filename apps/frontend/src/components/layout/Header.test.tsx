import { render, screen } from "@testing-library/preact";
import { LocationProvider } from "preact-iso";
import { expect, test } from "vitest";

import { SessionProvider } from "../session/SessionProvider.jsx";
import { Header } from "./Header.jsx";

test("marks only the link of the current route as the current page", async () => {
  render(
    <LocationProvider>
      <SessionProvider>
        <Header />
      </SessionProvider>
    </LocationProvider>,
  );

  const dashboard = screen.getByRole("link", { name: "Dashboard" });
  const admin = await screen.findByRole("link", { name: "Admin" });

  expect(dashboard.getAttribute("aria-current")).toBe("page");
  expect(admin.getAttribute("aria-current")).toBeNull();
});
