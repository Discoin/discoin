import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/preact";
import { LocationProvider } from "preact-iso";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { CurrentUser } from "../../api/types.js";
import {
  installFakeMatchMedia,
  type FakeMedia,
} from "../../lib/fakeMatchMedia.js";
import { AccountMenu } from "../session/AccountMenu.jsx";
import { SessionProvider } from "../session/SessionProvider.jsx";
import { ResourcesMenu } from "./ResourcesMenu.jsx";

const USER: CurrentUser = {
  userId: "115269304705875969",
  username: "coinkeeper",
  avatarUrl: "https://cdn.discordapp.com/avatars/115269304705875969/abc.png",
  defaultAvatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
  isAdmin: false,
  ownedBots: [],
};

vi.mock("../../api/client.js", () => ({
  LOGIN_PATH: "/api/auth/discord/login",
  api: { getMe: () => Promise.resolve(USER) },
}));

let media: FakeMedia;

beforeEach(() => {
  media = installFakeMatchMedia();
});

afterEach(cleanup);

function resourcesButton() {
  return screen.getByRole("button", { name: "Resources" });
}

function openResources() {
  render(<ResourcesMenu />);
  fireEvent.click(resourcesButton());

  return screen.getByRole("link", { name: "API Docs" });
}

test("Resources starts collapsed", () => {
  render(<ResourcesMenu />);

  expect(resourcesButton().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("link", { name: "API Docs" })).toBeNull();
});

test("clicking Resources toggles the list of resource links it controls", () => {
  const docs = openResources();
  const list = docs.closest("ul");

  expect(resourcesButton().getAttribute("aria-expanded")).toBe("true");
  expect(resourcesButton().getAttribute("aria-controls")).toBe(list?.id);
  expect(docs.getAttribute("href")).toBe("/api/docs");
  expect(docs.hasAttribute("target")).toBe(false);

  fireEvent.click(resourcesButton());
  expect(resourcesButton().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("link", { name: "API Docs" })).toBeNull();
});

test("Escape closes Resources and returns focus to it", () => {
  const docs = openResources();
  docs.focus();
  fireEvent.keyDown(docs, { key: "Escape" });

  expect(screen.queryByRole("link", { name: "API Docs" })).toBeNull();
  expect(document.activeElement).toBe(resourcesButton());
});

test("a pointer down outside closes Resources, one inside does not", () => {
  const docs = openResources();

  fireEvent.pointerDown(docs);
  expect(screen.getByRole("link", { name: "API Docs" })).toBeTruthy();

  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("link", { name: "API Docs" })).toBeNull();
});

test("becoming a phone closes Resources", () => {
  openResources();
  act(() => media.change(true));

  expect(screen.queryByRole("link", { name: "API Docs" })).toBeNull();
});

test("opening Resources closes the account menu and the other way round", async () => {
  render(
    <LocationProvider>
      <SessionProvider>
        <ResourcesMenu />
        <AccountMenu />
      </SessionProvider>
    </LocationProvider>,
  );
  const account = await screen.findByRole("button", {
    name: "Account: coinkeeper",
  });

  fireEvent.click(account);
  fireEvent.click(resourcesButton());
  expect(account.getAttribute("aria-expanded")).toBe("false");
  expect(resourcesButton().getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(account);
  expect(account.getAttribute("aria-expanded")).toBe("true");
  expect(resourcesButton().getAttribute("aria-expanded")).toBe("false");
});
