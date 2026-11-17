import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  PHONE_VIEWPORT,
  logOutFromDrawer,
  openOwnerReversalReview,
  openPage,
  reversalTable,
  startAsMockViewer,
  waitForData,
} from "./support.js";

const PEBBLES_INTO_OATS = "019a7c2f-91d0-7c66-8b14-f5a03e7d2c90";
const NEWEST = "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4";
const BLOCKED_BY_HARVEST_BOT = "01989c4e-2f10-7a3b-9c41-5d7e0b8a2f61";
const BLOCKED_TRADER_ID = "293847561029384756";
const UNKNOWN = "019a0000-0000-7000-8000-000000000000";
const STRANGER_ID = "700000000000000007";
const SHORT_VIEWPORT = { width: 1280, height: 400 };
const SCROLL_STEP = 300;

function transactionLink(scope: Page | Locator, id: string): Locator {
  return scope.getByRole("link", { name: `Transaction ${id}` });
}

function fact(page: Page, label: string): Locator {
  return page
    .locator(".transaction-facts__row")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("dd");
}

async function expectTransactionPage(page: Page, id: string): Promise<void> {
  await expect(page).toHaveURL(`/transactions/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Transaction ${id.slice(-6)}`,
  );
  await waitForData(page);
  await expect(fact(page, "ID")).toHaveText(id);
}

async function expectNotFound(page: Page, path: string): Promise<void> {
  await openPage(page, path);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "404: Not Found",
  );
  await expect(page).toHaveTitle("Page not found | Discoin");
  await expect(page).toHaveURL(path);
}

test("a trade opens from its ID in the recent transactions by mouse", async ({
  page,
}) => {
  await openPage(page, "/");
  const recent = page.getByRole("table", { name: "Recent transactions" });

  await transactionLink(recent, PEBBLES_INTO_OATS).click();

  await expectTransactionPage(page, PEBBLES_INTO_OATS);
});

test("a trade opens from its ID by keyboard", async ({ page }) => {
  await openPage(page, "/");
  await page.getByRole("region", { name: "Recent transactions table" }).focus();

  await page.keyboard.press("Tab");
  await expect(transactionLink(page, NEWEST)).toBeFocused();
  await page.keyboard.press("Enter");

  await expectTransactionPage(page, NEWEST);
});

test("a trade opens from the reversal review, leaving the dialog behind and nothing blocked", async ({
  page,
}) => {
  await page.setViewportSize(SHORT_VIEWPORT);
  await openPage(page, "/owner");
  await openOwnerReversalReview(page);

  await transactionLink(reversalTable(page), PEBBLES_INTO_OATS).click();

  await expectTransactionPage(page, PEBBLES_INTO_OATS);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[inert], dialog[open]")).toHaveCount(0);
  await expect(page.locator("main")).toBeFocused();
  await expect(fact(page, "Status")).toHaveText("Completed");
  await expect(page.locator(".toast")).toHaveCount(0);

  await page.mouse.wheel(0, SCROLL_STEP);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("main").getByRole("link", { name: "PBL", exact: true }),
  ).toBeFocused();
});

test("a direct link shows the cause and the user to a privileged viewer", async ({
  page,
}) => {
  await openPage(page, `/transactions/${BLOCKED_BY_HARVEST_BOT}`);

  await expect(page).toHaveTitle("Transaction 8a2f61 | Discoin");
  await expect(fact(page, "User ID")).toHaveText(BLOCKED_TRADER_ID);
  await expect(fact(page, "Status")).toHaveText("Cancelled");
  await expect(fact(page, "Cause")).toContainText(
    "Blocked by the bot owner of Harvest bot.",
  );
  await expect(fact(page, "Cause")).toContainText(
    "Reason: Farmed oats with an alt account.",
  );
});

test("an unrelated viewer sees only the public facts", async ({ page }) => {
  await startAsMockViewer(page, STRANGER_ID);
  await openPage(page, `/transactions/${BLOCKED_BY_HARVEST_BOT}`);

  await expect(fact(page, "Status")).toHaveText("Cancelled");
  await expect(fact(page, "User ID")).toHaveCount(0);
  await expect(fact(page, "Cause")).toHaveCount(0);
  await expect(page.getByText(BLOCKED_TRADER_ID)).toHaveCount(0);
});

test("logging out hides the private rows and logging back in shows them", async ({
  page,
}) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, `/transactions/${BLOCKED_BY_HARVEST_BOT}`);
  await expect(fact(page, "User ID")).toHaveText(BLOCKED_TRADER_ID);

  await logOutFromDrawer(page);
  await waitForData(page);

  await expect(fact(page, "Status")).toHaveText("Cancelled");
  await expect(fact(page, "User ID")).toHaveCount(0);
  await expect(fact(page, "Cause")).toHaveCount(0);

  await page.reload();
  await waitForData(page);

  await expect(fact(page, "User ID")).toHaveText(BLOCKED_TRADER_ID);
  await expect(fact(page, "Cause")).toBeVisible();
});

test("an unknown, malformed or reserved ID shows the 404 page at the same address", async ({
  page,
}) => {
  for (const id of [UNKNOWN, "not-a-transaction", "pending"]) {
    await expectNotFound(page, `/transactions/${id}`);
    await expect(page.getByText("Couldn't load transaction")).toHaveCount(0);
  }
});
