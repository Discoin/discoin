import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  WCAG_22_AA_TAGS,
  openPage,
  startWithEveryCurrencyInactive,
  waitForData,
} from "./support.js";

const THEMES = ["light", "dark"] as const;

function accountButton(page: Page) {
  return page.getByRole("button", { name: "Account: coinkeeper" });
}

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

test("on a phone the avatar shares the top row with Discoin, at the right", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openPage(page, "/");
  const brand = await page.locator(".site-header__brand").boundingBox();
  const avatar = await accountButton(page).boundingBox();
  if (brand === null || avatar === null) throw new Error("Header not laid out");

  const brandMiddle = brand.y + brand.height / 2;
  const avatarMiddle = avatar.y + avatar.height / 2;
  expect(Math.abs(brandMiddle - avatarMiddle)).toBeLessThanOrEqual(4);
  expect(360 - (avatar.x + avatar.width)).toBeLessThanOrEqual(24);
});

async function middleOf(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Element not laid out");

  return box.y + box.height / 2;
}

test("on a 360px phone the theme toggle joins Discoin and the avatar in the top row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openPage(page, "/");
  const brand = await middleOf(page.locator(".site-header__brand"));

  expect(
    Math.abs((await middleOf(page.locator(".theme-toggle"))) - brand),
  ).toBeLessThanOrEqual(6);
  expect(
    Math.abs((await middleOf(accountButton(page))) - brand),
  ).toBeLessThanOrEqual(4);
});

for (const width of [320, 360]) {
  test(`logged out on a ${width}px phone, Discoin, the theme button and Log in share the top row`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openPage(page, "/");
    await logOut(page);
    const header = page.locator(".site-header__bar");
    const brand = await middleOf(page.locator(".site-header__brand"));
    const login = header.getByRole("link", { name: "Log in with Discord" });

    expect(Math.abs((await middleOf(login)) - brand)).toBeLessThanOrEqual(8);
    expect(
      Math.abs((await middleOf(page.locator(".theme-toggle"))) - brand),
    ).toBeLessThanOrEqual(8);
  });
}

test("on a phone, Discoin, the theme toggle and the avatar share one middle line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openPage(page, "/");
  await page.evaluate(() => document.fonts.ready);
  const wordmark = await middleOf(
    page.locator(".site-header__brand > *").first(),
  );

  expect(
    Math.abs((await middleOf(page.locator(".theme-toggle"))) - wordmark),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((await middleOf(accountButton(page))) - wordmark),
  ).toBeLessThanOrEqual(1);
});
