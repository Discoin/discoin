import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { LocationProvider } from "preact-iso";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { ApiError } from "../../api/errors.js";
import type { CurrentUser } from "../../api/types.js";
import {
  installFakeMatchMedia,
  type FakeMedia,
} from "../../lib/fakeMatchMedia.js";
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
  logout: (): Promise<void> => Promise.resolve(),
}));

vi.mock("../../api/client.js", () => ({
  LOGIN_PATH: "/api/auth/discord/login",
  api: {
    getMe: () => fakeApi.getMe(),
    logout: () => fakeApi.logout(),
  },
}));

let media: FakeMedia;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  media = installFakeMatchMedia();
  fakeApi.getMe = () => Promise.resolve(ADMIN);
  fakeApi.logout = () => Promise.resolve();
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

test("the drawer is closed until the menu button opens it", () => {
  renderDrawer();

  expectClosed();
  expect(menuButton().getAttribute("aria-controls")).toBeTruthy();
});

test("the menu button opens a modal named Menu with focus on its close button", async () => {
  const view = await openReadyDrawer();

  expect(menuButton().getAttribute("aria-expanded")).toBe("true");
  expect(menuButton().getAttribute("aria-controls")).toBe(drawer().id);
  expect(drawer().hasAttribute("open")).toBe(true);
  expect(document.activeElement).toBe(
    view.getByRole("button", { name: "Close menu" }),
  );
});

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

test("Escape closes the whole drawer with Resources open, refocuses the menu button, and Resources starts collapsed again", async () => {
  const view = await openReadyDrawer();
  fireEvent.click(view.getByRole("button", { name: "Resources" }));
  fireEvent(drawer(), new Event("cancel", { cancelable: true }));

  expectClosed();
  expect(document.activeElement).toBe(menuButton());

  const reopened = openDrawer();
  expect(
    reopened
      .getByRole("button", { name: "Resources" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

test("the close button closes the drawer and refocuses the menu button", async () => {
  const view = await openReadyDrawer();
  fireEvent.click(view.getByRole("button", { name: "Close menu" }));

  expectClosed();
  expect(document.activeElement).toBe(menuButton());
});

test("a click on the backdrop closes the drawer, a click inside it does not", async () => {
  const view = await openReadyDrawer();

  fireEvent.click(view.getByRole("navigation", { name: "Main" }));
  expect(drawer()).toBeTruthy();

  fireEvent.click(drawer());
  expectClosed();
});

for (const name of ["Discoin", "Dashboard", "My transactions"]) {
  test(`following ${name} closes the drawer, even when it is the current page`, async () => {
    const view = await openReadyDrawer();
    fireEvent.click(view.getByRole("link", { name }));

    expectClosed();
  });
}

test("following API Docs closes the drawer", async () => {
  const view = await openReadyDrawer();
  fireEvent.click(view.getByRole("button", { name: "Resources" }));
  fireEvent.click(view.getByRole("link", { name: "API Docs" }));

  expectClosed();
});

test("following Log in closes the drawer", async () => {
  signInAs(null);
  const view = await openReadyDrawer();
  fireEvent.click(view.getByRole("link", { name: LOG_IN }));

  expectClosed();
});

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

test("Log out is not focused when the drawer opens", async () => {
  const view = await openReadyDrawer();

  expect(document.activeElement).not.toBe(
    view.getByRole("button", { name: "Log out" }),
  );
});

test("a failed logout keeps the drawer open with the error above Log out", async () => {
  fakeApi.logout = () =>
    Promise.reject(new ApiError(500, "Logging out failed."));
  const view = await openReadyDrawer();
  const logout = view.getByRole("button", { name: "Log out" });
  fireEvent.click(logout);

  const error = await view.findByText("Logging out failed.");
  expect(drawer()).toBeTruthy();
  expect(error.closest(".nav-drawer__foot")).toBe(logout.parentElement);
  expect(
    error.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("a successful logout closes the drawer", async () => {
  const view = await openReadyDrawer();
  fireEvent.click(view.getByRole("button", { name: "Log out" }));

  await waitFor(expectClosed);
});

test("growing past the phone width closes the drawer", async () => {
  await openReadyDrawer();
  act(() => media.change(false));

  expectClosed();
});
