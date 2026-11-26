import { expect, test, type Page } from "@playwright/test";

import {
  accountButton,
  boxOf,
  expectOnDocsPage,
  menuButton,
  openPage,
} from "./support.js";

function resourcesButton(page: Page) {
  return page.getByRole("button", { name: "Resources" });
}

function apiDocsLink(page: Page) {
  return page.getByRole("link", { name: "API Docs", exact: true });
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
  await expect(apiDocsLink(page)).toHaveAttribute("href", "/docs");
  await expect(apiDocsLink(page)).not.toHaveAttribute("target");

  await resourcesButton(page).click();
  await expect(apiDocsLink(page)).toHaveCount(0);
});

test("the keyboard opens Resources with Enter and with Space", async ({
  page,
}) => {
  await openPage(page, "/");

  for (const key of ["Enter", " "]) {
    await resourcesButton(page).focus();
    await page.keyboard.press(key);
    await expect(apiDocsLink(page), key).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(apiDocsLink(page), key).toHaveCount(0);
  }
});

test("API Docs opens the docs page in the app and closes Resources", async ({
  page,
}) => {
  await openPage(page, "/");
  await resourcesButton(page).click();
  await apiDocsLink(page).click();

  await expectOnDocsPage(page);
  await expect(resourcesButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(apiDocsLink(page)).toHaveCount(0);
});
