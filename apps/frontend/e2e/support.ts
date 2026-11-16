import { expect, type Locator, type Page } from "@playwright/test";

import {
  FAILED_LOGOUT_MESSAGE,
  FAILING_LOGOUT_KEY,
} from "../src/mocks/failingLogout.js";
import { INACTIVE_MARKET_KEY } from "../src/mocks/inactiveMarket.js";
import {
  DEACTIVATED_ON_RENAME_KEY,
  LOST_CONNECTION_ON_RENAME_KEY,
  STALLED_RENAMES_KEY,
} from "../src/mocks/ownerScenarios.js";

export const WCAG_22_AA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

const LOADING_PLACEHOLDERS =
  ".loadable__loading:not(.specimen *), .site-header__ticker-note";

export async function waitForData(page: Page): Promise<void> {
  await expect(page.locator(LOADING_PLACEHOLDERS)).toHaveCount(0);
}

export const TRADER_ID = "530917284650193847";

export async function startReversal(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Block a user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Discord user ID").fill(TRADER_ID);
  await dialog.getByLabel("Reason").fill("Laundered coins through alts.");
  await dialog.getByLabel("Also reverse their completed transactions").check();

  return dialog;
}

export async function reviewReversal(dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Review reversal" }).click();
  await expect(dialog.getByText("Review the reversal")).toBeFocused();
}

export function reversalTable(page: Page): Locator {
  return page.getByRole("table", { name: "Transactions to reverse" });
}

export async function openAdminReversalReview(page: Page): Promise<void> {
  const dialog = await startReversal(page);
  await dialog.getByLabel("All time").check();
  await reviewReversal(dialog);
  await expect(reversalTable(page)).toBeVisible();
}

export async function openOwnerReversalReview(page: Page): Promise<void> {
  const dialog = await startReversal(page);
  await dialog.getByLabel("All time").check();
  await dialog.getByLabel("Both", { exact: true }).check();
  await reviewReversal(dialog);
  await expect(reversalTable(page)).toBeVisible();
}

async function startWithMockSetting(page: Page, key: string): Promise<void> {
  await page.addInitScript((setting) => {
    sessionStorage.setItem(setting, "true");
  }, key);
}

export async function startWithEveryCurrencyInactive(
  page: Page,
): Promise<void> {
  await startWithMockSetting(page, INACTIVE_MARKET_KEY);
}

export function startWithRenamesFindingCurrencyDeactivated(
  page: Page,
): Promise<void> {
  return startWithMockSetting(page, DEACTIVATED_ON_RENAME_KEY);
}

export function startWithStalledRenames(page: Page): Promise<void> {
  return startWithMockSetting(page, STALLED_RENAMES_KEY);
}

export async function startWithFailingLogout(page: Page): Promise<void> {
  await startWithMockSetting(page, FAILING_LOGOUT_KEY);
}

export function startWithRenamesLosingConnection(page: Page): Promise<void> {
  return startWithMockSetting(page, LOST_CONNECTION_ON_RENAME_KEY);
}

export async function openPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForData(page);
}

export function picker(page: Page, label: string): Locator {
  return page.getByRole("combobox", { name: label, exact: true });
}

export async function choosePickerOption(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await picker(page, label).click();
  await page
    .getByRole("listbox", { name: label, exact: true })
    .getByRole("option", { name: option, exact: true })
    .click();
  await waitForData(page);
}

export async function expectPickerOptions(
  page: Page,
  label: string,
  names: string[],
): Promise<void> {
  await picker(page, label).click();
  const options = page
    .getByRole("listbox", { name: label, exact: true })
    .getByRole("option");
  await expect(options).toHaveCount(names.length);

  for (const [index, name] of names.entries()) {
    await expect(options.nth(index)).toHaveAccessibleName(name);
  }

  await page.keyboard.press("Escape");
}

export const PHONE_VIEWPORT = { width: 360, height: 800 };
export const NARROW_PHONE_VIEWPORT = { width: 320, height: 800 };
export const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

export function accountButton(page: Page): Locator {
  return page.getByRole("button", { name: "Account: coinkeeper" });
}

export function pageSidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

export function sidewaysOverflow(element: Locator): Promise<number> {
  return element.evaluate((box) => box.scrollWidth - box.clientWidth);
}

export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Element not laid out");

  return box;
}

const API_DOCS_TITLE = "Discoin API - Swagger UI";

export async function stubApiDocs(page: Page): Promise<string[]> {
  const documentRequests: string[] = [];
  await page.route("**/api/docs", (route) => {
    if (route.request().isNavigationRequest()) {
      documentRequests.push(route.request().url());
    }

    return route.fulfill({
      contentType: "text/html",
      body: `<title>${API_DOCS_TITLE}</title><div id="swagger-ui"></div>`,
    });
  });

  return documentRequests;
}

export async function expectLeftForApiDocs(
  page: Page,
  documentRequests: string[],
): Promise<void> {
  await expect(page).toHaveTitle(API_DOCS_TITLE);
  expect(new URL(page.url()).pathname).toBe("/api/docs");
  await expect(page.locator(".site-header")).toHaveCount(0);
  expect(documentRequests).toHaveLength(1);
  expect(page.context().pages()).toHaveLength(1);
}

export function menuButton(page: Page): Locator {
  return page.getByRole("button", { name: "Menu", exact: true });
}

export function navDrawer(page: Page): Locator {
  return page.getByRole("dialog", { name: "Menu" });
}

export function drawerBrand(drawer: Locator): Locator {
  return drawer.getByRole("link", { name: "Discoin", exact: true });
}

export function drawerResources(drawer: Locator): Locator {
  return drawer.getByRole("button", { name: "Resources" });
}

export function drawerApiDocs(drawer: Locator): Locator {
  return drawer.getByRole("link", { name: "API Docs" });
}

export async function openNavDrawer(page: Page): Promise<Locator> {
  await menuButton(page).click();
  const drawer = navDrawer(page);
  await expect(drawer).toBeVisible();
  await drawer.evaluate((element) =>
    Promise.all(element.getAnimations().map((slide) => slide.finished)),
  );

  return drawer;
}

export async function failLogOutFromDrawer(page: Page): Promise<Locator> {
  const drawer = await openNavDrawer(page);
  await drawer.getByRole("button", { name: "Log out" }).click();
  await expect(drawer.getByText(FAILED_LOGOUT_MESSAGE)).toBeVisible();

  return drawer;
}

export async function logOutFromDrawer(page: Page): Promise<void> {
  const drawer = await openNavDrawer(page);
  await drawer.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByText("You're logged out.")).toBeVisible();
}
