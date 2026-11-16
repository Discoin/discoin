import { expect, test, type Page } from "@playwright/test";

import {
  DESKTOP_VIEWPORT,
  PHONE_VIEWPORT,
  accountButton,
  boxOf,
  expectLeftForApiDocs,
  menuButton,
  openPage,
  stubApiDocs,
} from "./support.js";

function resourcesButton(page: Page) {
  return page.getByRole("button", { name: "Resources" });
}

function apiDocsLink(page: Page) {
  return page.getByRole("link", { name: "API Docs" });
}

test("Resources sits right of the Main nav, before the theme toggle and the account", async ({
  page,
}) => {
  await openPage(page, "/");
  const nav = await boxOf(page.getByRole("navigation", { name: "Main" }));
  const resources = await boxOf(resourcesButton(page));
  const theme = await boxOf(page.locator(".theme-toggle"));
  const account = await boxOf(accountButton(page));

  expect(resources.x).toBeGreaterThan(nav.x + nav.width);
  expect(theme.x).toBeGreaterThan(resources.x);
  expect(account.x).toBeGreaterThan(theme.x);
  await expect(menuButton(page)).toBeHidden();
});

test("Resources is collapsed until clicked, then lists API Docs", async ({
  page,
}) => {
  await openPage(page, "/");

  await expect(resourcesButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(apiDocsLink(page)).toHaveCount(0);

  await resourcesButton(page).click();
  await expect(resourcesButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(apiDocsLink(page)).toHaveAttribute("href", "/api/docs");
  await expect(apiDocsLink(page)).not.toHaveAttribute("target");

  await resourcesButton(page).click();
  await expect(apiDocsLink(page)).toHaveCount(0);
});

for (const key of ["Enter", " "]) {
  test(`the keyboard opens Resources with ${key === " " ? "Space" : key}`, async ({
    page,
  }) => {
    await openPage(page, "/");
    await resourcesButton(page).focus();
    await page.keyboard.press(key);

    await expect(apiDocsLink(page)).toBeVisible();
  });
}

test("Escape closes Resources and returns focus to it", async ({ page }) => {
  await openPage(page, "/");
  await resourcesButton(page).click();
  await apiDocsLink(page).focus();
  await page.keyboard.press("Escape");

  await expect(apiDocsLink(page)).toHaveCount(0);
  await expect(resourcesButton(page)).toBeFocused();
});

test("clicking outside closes Resources", async ({ page }) => {
  await openPage(page, "/");
  await resourcesButton(page).click();
  await page.getByRole("heading", { level: 1 }).click();

  await expect(apiDocsLink(page)).toHaveCount(0);
});

test("opening Resources closes the account menu and the other way round", async ({
  page,
}) => {
  await openPage(page, "/");
  await accountButton(page).click();
  await resourcesButton(page).focus();
  await page.keyboard.press("Enter");

  await expect(apiDocsLink(page)).toBeVisible();
  await expect(accountButton(page)).toHaveAttribute("aria-expanded", "false");

  await accountButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(accountButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(resourcesButton(page)).toHaveAttribute("aria-expanded", "false");
});

test("API Docs leaves the app for the API's Swagger page in the same tab", async ({
  page,
}) => {
  const documentRequests = await stubApiDocs(page);
  await openPage(page, "/");
  await resourcesButton(page).click();
  await apiDocsLink(page).click();

  await expectLeftForApiDocs(page, documentRequests);
});

test("shrinking to a phone closes an open Resources menu", async ({ page }) => {
  await openPage(page, "/");
  await resourcesButton(page).click();
  await expect(apiDocsLink(page)).toBeVisible();
  await page.setViewportSize(PHONE_VIEWPORT);
  await expect(page.locator(".resources-menu__trigger")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await expect(resourcesButton(page)).toBeVisible();
  await expect(apiDocsLink(page)).toHaveCount(0);
});
