import { render, screen } from "@testing-library/preact";
import { LocationProvider } from "preact-iso";
import { expect, test, vi } from "vitest";

import { SessionProvider } from "../session/SessionProvider.jsx";
import { Header } from "./Header.jsx";

vi.mock("../../api/client.js", () => ({
  LOGIN_PATH: "/api/auth/discord/login",
  api: {
    listCurrencies: () => Promise.reject(new Error("Server down.")),
    getMe: () => Promise.resolve(null),
  },
}));

test("the ticker says when prices fail to load and offers a retry", async () => {
  render(
    <LocationProvider>
      <SessionProvider>
        <Header />
      </SessionProvider>
    </LocationProvider>,
  );

  expect(await screen.findByText(/Prices didn't load/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});
