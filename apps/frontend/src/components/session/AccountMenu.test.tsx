import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";

import type { CurrentUser } from "../../api/types.js";
import { AccountMenu } from "./AccountMenu.jsx";
import { SessionProvider } from "./SessionProvider.jsx";

const AVATAR_URL =
  "https://cdn.discordapp.com/avatars/115269304705875969/abc.png";
const DEFAULT_AVATAR_URL = "https://cdn.discordapp.com/embed/avatars/1.png";

const USER: CurrentUser = {
  userId: "115269304705875969",
  username: "coinkeeper",
  avatarUrl: AVATAR_URL,
  defaultAvatarUrl: DEFAULT_AVATAR_URL,
  isAdmin: false,
  ownedCurrencyIds: [],
};

vi.mock("../../api/client.js", () => ({
  LOGIN_PATH: "/api/auth/discord/login",
  api: { getMe: () => Promise.resolve(USER) },
}));

async function renderAvatar(): Promise<HTMLImageElement> {
  const { container } = render(
    <SessionProvider>
      <AccountMenu />
    </SessionProvider>,
  );
  await screen.findByRole("button", { name: "Account: coinkeeper" });

  const avatar = container.querySelector("img");
  if (avatar === null) throw new Error("The account menu has no avatar");

  return avatar;
}

test("the avatar is decorative because the button names the account", async () => {
  const avatar = await renderAvatar();

  expect(avatar.getAttribute("alt")).toBe("");
  expect(avatar.getAttribute("src")).toBe(AVATAR_URL);
});

test("an avatar that fails to load switches to the Discord default once", async () => {
  const avatar = await renderAvatar();

  fireEvent.error(avatar);
  expect(avatar.getAttribute("src")).toBe(DEFAULT_AVATAR_URL);

  fireEvent.error(avatar);
  expect(avatar.getAttribute("src")).toBe(DEFAULT_AVATAR_URL);
});
