import { render, screen, waitFor } from "@testing-library/preact";
import { LocationProvider } from "preact-iso";
import { expect, test, vi } from "vitest";

import type { CurrentUser } from "../../api/types.js";
import { SessionProvider } from "../session/SessionProvider.jsx";
import { Header } from "./Header.jsx";

const USER: CurrentUser = {
  userId: "115269304705875969",
  username: "coinkeeper",
  avatarUrl: "https://cdn.discordapp.com/avatars/115269304705875969/abc.png",
  defaultAvatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
  isAdmin: false,
  ownedCurrencyIds: [],
};

vi.mock("../../api/client.js", () => ({
  LOGIN_PATH: "/api/auth/discord/login",
  api: {
    listCurrencies: () => Promise.resolve([]),
    getMe: () => Promise.resolve(USER),
  },
}));

test("with no active currencies the header keeps the avatar and shows no ticker", async () => {
  const { container } = render(
    <LocationProvider>
      <SessionProvider>
        <Header />
      </SessionProvider>
    </LocationProvider>,
  );

  expect(
    await screen.findByRole("button", { name: "Account: coinkeeper" }),
  ).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("Loading prices")).toBeNull());
  expect(container.querySelector(".ticker")).toBeNull();
  expect(screen.queryByRole("button", { name: "Pause ticker" })).toBeNull();
});
