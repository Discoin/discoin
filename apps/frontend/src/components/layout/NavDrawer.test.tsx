import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { LocationProvider } from "preact-iso";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

import type { CurrentUser } from "../../api/types.js";
import { installFakeMatchMedia } from "../../lib/fakeMatchMedia.js";
import { SessionProvider } from "../session/SessionProvider.jsx";
import { NavDrawer } from "./NavDrawer.jsx";

const ADMIN: CurrentUser = {
  userId: "115269304705875969",
  username: "coinkeeper",
  avatarUrl: "https://cdn.discordapp.com/avatars/115269304705875969/abc.png",
  defaultAvatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
  isAdmin: true,
  ownedBots: [{ id: "oat-bot", name: "Oat bot", currencyIds: ["oats"] }],
};

const LOG_IN = /^Log in/;

const fakeApi = vi.hoisted(() => ({
  getMe: (): Promise<unknown> => Promise.resolve(null),
}));

vi.mock("../../api/client.js", () => ({
  LOGIN_PATH: "/api/auth/discord/login",
  api: {
    getMe: () => fakeApi.getMe(),
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  installFakeMatchMedia();
  fakeApi.getMe = () => Promise.resolve(ADMIN);
});

afterEach(cleanup);

function signInAs(user: CurrentUser | null) {
  fakeApi.getMe = () => Promise.resolve(user);
}

function renderDrawer() {
  render(
    <LocationProvider>
      <SessionProvider>
        <NavDrawer />
      </SessionProvider>
    </LocationProvider>,
  );
}

function menuButton() {
  return screen.getByRole("button", { name: "Menu" });
}

function drawer() {
  return screen.getByRole("dialog", { name: "Menu" });
}

function openDrawer() {
  fireEvent.click(menuButton());

  return within(drawer());
}

async function openReadyDrawer() {
  renderDrawer();
  await act(() => Promise.resolve());

  return openDrawer();
}

function expectClosed() {
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(menuButton().getAttribute("aria-expanded")).toBe("false");
}

function focusables(): Element[] {
  return [...drawer().querySelectorAll("a, button")];
}

test("logged in, the drawer reads brand, close, the user, Main links, Resources, then Log out", async () => {
  const view = await openReadyDrawer();
  const brand = view.getByRole("link", { name: "Discoin" });

  expect(brand.getAttribute("href")).toBe("/");
  expect(brand.classList.contains("site-header__brand")).toBe(false);
  expect(view.getByText("coinkeeper").querySelector("img")?.alt).toBe("");
  expect(view.getByRole("separator")).toBeTruthy();
  expect(view.queryByRole("link", { name: /Log in/ })).toBeNull();
  expect(focusables()).toEqual([
    brand,
    view.getByRole("button", { name: "Close menu" }),
    view.getByRole("link", { name: "Dashboard" }),
    view.getByRole("link", { name: "My transactions" }),
    view.getByRole("link", { name: "Bot owner" }),
    view.getByRole("link", { name: "Admin" }),
    view.getByRole("button", { name: "Resources" }),
    view.getByRole("button", { name: "Log out" }),
  ]);
});

test("logged out, Log in follows the close button, then the separator, and there is no Log out", async () => {
  signInAs(null);
  const view = await openReadyDrawer();
  const login = view.getByRole("link", { name: LOG_IN });

  expect(login.getAttribute("href")).toBe("/api/auth/discord/login?next=%2F");
  expect(
    login.compareDocumentPosition(view.getByRole("separator")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(view.queryByRole("button", { name: "Log out" })).toBeNull();
  expect(drawer().querySelector(".nav-drawer__foot")).toBeNull();
  expect(focusables()).toEqual([
    view.getByRole("link", { name: "Discoin" }),
    view.getByRole("button", { name: "Close menu" }),
    login,
    view.getByRole("link", { name: "Dashboard" }),
    view.getByRole("button", { name: "Resources" }),
  ]);
});

test("the Main links in the drawer follow the user and mark the current page", async () => {
  signInAs({ ...ADMIN, isAdmin: false, ownedBots: [] });
  const view = await openReadyDrawer();
  const nav = within(view.getByRole("navigation", { name: "Main" }));

  expect(
    nav.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(
    nav
      .getByRole("link", { name: "My transactions" })
      .getAttribute("aria-current"),
  ).toBeNull();
  expect(nav.queryByRole("link", { name: "Bot owner" })).toBeNull();
  expect(nav.queryByRole("link", { name: "Admin" })).toBeNull();
});

test("Resources in the drawer starts collapsed and expands to API Docs before Log out", async () => {
  const view = await openReadyDrawer();
  const resources = view.getByRole("button", { name: "Resources" });

  expect(resources.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(resources);

  const docs = view.getByRole("link", { name: "API Docs" });
  expect(resources.getAttribute("aria-expanded")).toBe("true");
  expect(resources.getAttribute("aria-controls")).toBe(docs.closest("ul")?.id);
  expect(docs.getAttribute("href")).toBe("/api/docs");
  expect(focusables().slice(-3)).toEqual([
    resources,
    docs,
    view.getByRole("button", { name: "Log out" }),
  ]);
});

test("a click on the backdrop closes the drawer, a click inside it does not", async () => {
  const view = await openReadyDrawer();

  fireEvent.click(view.getByRole("navigation", { name: "Main" }));
  expect(drawer()).toBeTruthy();

  fireEvent.click(drawer());
  expectClosed();
});

test.each([
  { name: "Dashboard", user: ADMIN },
  { name: LOG_IN, user: null },
])(
  "following $name closes the drawer, even on the current page",
  async ({ name, user }) => {
    signInAs(user);
    const view = await openReadyDrawer();
    fireEvent.click(view.getByRole("link", { name }));

    expectClosed();
  },
);

test("while the session loads, the account block is empty and there is no footer", () => {
  fakeApi.getMe = () => new Promise(() => undefined);
  renderDrawer();
  const view = openDrawer();
  const account = drawer().querySelector(".nav-drawer__account");

  expect(account?.childElementCount).toBe(0);
  expect(account?.textContent).toBe("");
  expect(view.queryByRole("separator")).toBeNull();
  expect(drawer().querySelector(".avatar")).toBeNull();
  expect(drawer().querySelector(".nav-drawer__foot")).toBeNull();
  expect(view.getByRole("link", { name: "Dashboard" })).toBeTruthy();
});
