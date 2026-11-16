import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { FAILED_LOGOUT_MESSAGE } from "../src/mocks/failingLogout.js";
import {
  PHONE_VIEWPORT,
  WCAG_22_AA_TAGS,
  accountButton,
  boxOf,
  failLogOutFromDrawer,
  logOutFromDrawer,
  menuButton,
  navDrawer,
  openNavDrawer,
  openPage,
  startWithEveryCurrencyInactive,
  startWithFailingLogout,
  waitForData,
} from "./support.js";

const THEMES = ["light", "dark"] as const;

async function logOut(page: Page) {
  await accountButton(page).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByText("You're logged out.")).toBeVisible();
}

test("the header shows who is logged in and every page they can open", async ({
  page,
}) => {
  await openPage(page, "/");
  const nav = page.getByRole("navigation", { name: "Main" });

  await expect(accountButton(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  for (const label of ["My transactions", "Bot owner", "Admin"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
});

test("with no active currencies the avatar still shows and nothing crashes", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await startWithEveryCurrencyInactive(page);
  await openPage(page, "/");

  await expect(accountButton(page)).toBeVisible();
  await expect(page.locator(".ticker")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("logging out hides the pages that need a login", async ({ page }) => {
  await openPage(page, "/");
  await logOut(page);
  const nav = page.getByRole("navigation", { name: "Main" });

  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  for (const label of ["My transactions", "Bot owner", "Admin"]) {
    await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
  }
});

test("a page that needs a login offers Discord login back to the same page", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await logOut(page);
  await waitForData(page);

  await expect(page.getByText("Log in to see this page")).toBeVisible();
  const login = page
    .getByRole("main")
    .getByRole("link", { name: "Log in with Discord" });
  await expect(login).toHaveAttribute(
    "href",
    "/api/auth/discord/login?next=%2Fowner",
  );
});

for (const theme of THEMES) {
  test(`the logged out view meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPage(page, "/admin");
    await logOut(page);
    await page.evaluate(() => document.fonts.ready);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test("the header login sits at the far right with the Discord logo", async ({
  page,
}) => {
  await openPage(page, "/");
  await logOut(page);
  const header = page.locator(".site-header__bar");
  const login = header.getByRole("link", { name: "Log in with Discord" });
  const theme = header.locator(".theme-toggle");

  await expect(login.locator(".visually-hidden")).toHaveText(" with Discord");
  await expect(login.locator("svg")).toHaveAttribute("aria-hidden", "true");
  const loginBox = await login.boundingBox();
  const themeBox = await theme.boundingBox();
  expect(loginBox?.x).toBeGreaterThan(themeBox?.x ?? Number.POSITIVE_INFINITY);
});

test("Log in leaves the app for the API login, once, with a clean return path", async ({
  page,
}) => {
  const loginRequests: string[] = [];
  await page.route("**/api/auth/discord/login**", (route) => {
    loginRequests.push(route.request().url());

    return route.fulfill({ status: 200, body: "Discord login" });
  });
  await openPage(page, "/currency/OAT");
  await logOut(page);

  await page
    .locator(".site-header__bar")
    .getByRole("link", { name: "Log in with Discord" })
    .click();

  await expect(page.getByText("Discord login")).toBeVisible();
  expect(loginRequests).toHaveLength(1);
  expect(new URL(loginRequests[0]).searchParams.get("next")).toBe(
    "/currency/OAT",
  );
});

test("the avatar opens the account panel: name, separator, then Log out", async ({
  page,
}) => {
  await openPage(page, "/");
  await accountButton(page).click();
  const panel = page.locator(".account-menu__panel");

  await expect(accountButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(panel.locator(".account-menu__name")).toHaveText("coinkeeper");
  await expect(panel.locator("hr")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Log out" })).toBeFocused();
});

test("Escape closes the account panel and returns focus to the avatar", async ({
  page,
}) => {
  await openPage(page, "/");
  await accountButton(page).click();
  await page.keyboard.press("Escape");

  await expect(page.locator(".account-menu__panel")).toHaveCount(0);
  await expect(accountButton(page)).toBeFocused();
  await expect(accountButton(page)).toHaveAttribute("aria-expanded", "false");
});

test("clicking outside closes the account panel", async ({ page }) => {
  await openPage(page, "/");
  await accountButton(page).click();
  await page.getByRole("heading", { level: 1 }).click();

  await expect(page.locator(".account-menu__panel")).toHaveCount(0);
});

for (const theme of THEMES) {
  test(`the open account panel meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPage(page, "/");
    await accountButton(page).click();
    await page.evaluate(() => document.fonts.ready);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

const EDGE_TOLERANCE_PX = 24;
const SUBPIXEL_PX = 1;
const LOGIN_UNDER_BRAND_MAX_GAP_PX = 8;
const MENU_ROW_TOLERANCE_PX = 4;
const THEME_ROW_TOLERANCE_PX = 6;

function middleOfBox(box: { y: number; height: number }) {
  return box.y + box.height / 2;
}

async function middleOf(locator: Locator) {
  return middleOfBox(await boxOf(locator));
}

test("on a phone the menu button shares the top row with Discoin, at the right", async ({
  page,
}) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, "/");
  const brand = await middleOf(page.locator(".site-header__brand"));
  const menu = await boxOf(menuButton(page));

  expect(Math.abs(middleOfBox(menu) - brand)).toBeLessThanOrEqual(
    MENU_ROW_TOLERANCE_PX,
  );
  expect(PHONE_VIEWPORT.width - (menu.x + menu.width)).toBeLessThanOrEqual(
    EDGE_TOLERANCE_PX,
  );
});

test("on a 360px phone the theme toggle joins Discoin and the menu button in the top row", async ({
  page,
}) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, "/");
  const brand = await middleOf(page.locator(".site-header__brand"));
  const theme = await boxOf(page.locator(".theme-toggle"));
  const menu = await boxOf(menuButton(page));

  expect(Math.abs(middleOfBox(theme) - brand)).toBeLessThanOrEqual(
    THEME_ROW_TOLERANCE_PX,
  );
  expect(Math.abs(middleOfBox(menu) - brand)).toBeLessThanOrEqual(
    MENU_ROW_TOLERANCE_PX,
  );
  expect(theme.x).toBeLessThan(menu.x);
});

for (const width of [320, 360]) {
  test(`logged out on a ${width}px phone, Log in sits in the drawer right under Discoin`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: PHONE_VIEWPORT.height });
    await openPage(page, "/");
    await logOutFromDrawer(page);

    await expect(
      page.locator(".site-header__bar").getByRole("link", { name: /Log in/ }),
    ).toHaveCount(0);
    const drawer = await openNavDrawer(page);
    const login = drawer.getByRole("link", { name: "Log in with Discord" });
    const head = await boxOf(drawer.locator(".nav-drawer__head"));
    const loginBox = await boxOf(login);

    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute(
      "href",
      "/api/auth/discord/login?next=%2F",
    );
    const headBottom = head.y + head.height;
    expect(loginBox.y).toBeGreaterThanOrEqual(headBottom - SUBPIXEL_PX);
    expect(loginBox.y - headBottom).toBeLessThanOrEqual(
      LOGIN_UNDER_BRAND_MAX_GAP_PX,
    );
  });
}

test("on a phone, Discoin, the theme toggle and the menu button share one middle line", async ({
  page,
}) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, "/");
  await page.evaluate(() => document.fonts.ready);
  const wordmark = await middleOf(
    page.locator(".site-header__brand > *").first(),
  );

  expect(
    Math.abs((await middleOf(page.locator(".theme-toggle"))) - wordmark),
  ).toBeLessThanOrEqual(SUBPIXEL_PX);
  expect(
    Math.abs((await middleOf(menuButton(page))) - wordmark),
  ).toBeLessThanOrEqual(SUBPIXEL_PX);
});

test("on a phone the drawer shows who is logged in at the top and Log out at the bottom", async ({
  page,
}) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, "/");
  await expect(accountButton(page)).toBeHidden();
  const drawer = await openNavDrawer(page);
  const user = drawer.locator(".nav-drawer__user");
  const logout = drawer.getByRole("button", { name: "Log out" });

  await expect(user).toHaveText("coinkeeper");
  await expect(user.locator("img")).toHaveAttribute("alt", "");
  await expect(drawer.getByRole("separator")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Account/ })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: /Log in/ })).toHaveCount(0);
  const logoutBox = await boxOf(logout);
  const userBox = await boxOf(user);
  const navBox = await boxOf(drawer.getByRole("navigation", { name: "Main" }));
  expect(userBox.y).toBeLessThan(navBox.y);
  expect(
    PHONE_VIEWPORT.height - (logoutBox.y + logoutBox.height),
  ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
});

test("logging out from the drawer closes it and hides the pages that need a login", async ({
  page,
}) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, "/");
  await logOutFromDrawer(page);

  await expect(navDrawer(page)).toHaveCount(0);
  const drawer = await openNavDrawer(page);
  const nav = drawer.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();

  for (const label of ["My transactions", "Bot owner", "Admin"]) {
    await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
  }

  await expect(drawer.getByRole("button", { name: "Log out" })).toHaveCount(0);
  await expect(drawer.getByRole("separator")).toBeVisible();
});

test("a failed logout keeps the drawer open with the error in the footer above Log out", async ({
  page,
}) => {
  await startWithFailingLogout(page);
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, "/");
  const drawer = await failLogOutFromDrawer(page);
  const footer = drawer.locator(".nav-drawer__foot");
  const error = footer.getByRole("status");
  const logout = footer.getByRole("button", { name: "Log out" });

  await expect(drawer).toBeVisible();
  await expect(error).toHaveText(FAILED_LOGOUT_MESSAGE);
  await expect(drawer.locator(".nav-drawer__user")).toHaveText("coinkeeper");
  await expect(page.getByText("You're logged out.")).toHaveCount(0);
  const errorBox = await boxOf(error);
  const logoutBox = await boxOf(logout);
  expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(logoutBox.y);
  expect(
    PHONE_VIEWPORT.height - (logoutBox.y + logoutBox.height),
  ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
});

test("Log in in the drawer leaves the app for the API login, once, with a clean return path", async ({
  page,
}) => {
  const loginRequests: string[] = [];
  await page.route("**/api/auth/discord/login**", (route) => {
    loginRequests.push(route.request().url());

    return route.fulfill({ status: 200, body: "Discord login" });
  });
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, "/currency/OAT");
  await logOutFromDrawer(page);

  const drawer = await openNavDrawer(page);
  await drawer.getByRole("link", { name: "Log in with Discord" }).click();

  await expect(page.getByText("Discord login")).toBeVisible();
  expect(loginRequests).toHaveLength(1);
  expect(new URL(loginRequests[0]).searchParams.get("next")).toBe(
    "/currency/OAT",
  );
});
