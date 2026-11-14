import { expect, type Locator, type Page } from "@playwright/test";

import { INACTIVE_MARKET_KEY } from "../src/mocks/inactiveMarket.js";

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

export async function startWithEveryCurrencyInactive(
  page: Page,
): Promise<void> {
  await page.addInitScript((key) => {
    sessionStorage.setItem(key, "true");
  }, INACTIVE_MARKET_KEY);
}

export async function openPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForData(page);
}
