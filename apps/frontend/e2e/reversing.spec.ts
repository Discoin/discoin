import { expect, test, type Page } from "@playwright/test";

import {
  TRADER_ID,
  openPage,
  reversalTable,
  reviewReversal,
  startReversal,
} from "./support.js";

const NOW = new Date("2026-11-13T00:00:00Z");
const PEBBLES_INTO_OATS = "019a7c2f-91d0-7c66-8b14-f5a03e7d2c90";
const TICKETS_INTO_OATS = "0199a1f0-3c55-7e21-9b40-6d2e81c7a5f3";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

function reviewRows(page: Page) {
  return reversalTable(page).locator("tbody tr");
}

async function reversedOnDashboard(page: Page) {
  await page.getByRole("link", { name: "Dashboard" }).click();

  return page
    .getByRole("table", { name: "Recent transactions" })
    .locator("tbody tr", { hasText: "Reversed" });
}

test("the reversal options only show once the checkbox is on", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await page.getByRole("button", { name: "Block a user" }).click();
  const dialog = page.getByRole("dialog");
  const windows = dialog.getByRole("group", {
    name: "Reverse transactions from",
  });

  await expect(windows).toHaveCount(0);
  await dialog.getByLabel("Also reverse their completed transactions").check();
  await expect(windows).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Direction" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Review reversal" }),
  ).toBeVisible();
});

test("an admin reviews the last 24 hours, then confirms the reversal", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const dialog = await startReversal(page);
  await expect(dialog.getByRole("group", { name: "Direction" })).toHaveCount(0);
  await reviewReversal(dialog);

  await expect(
    dialog.getByText("3 transactions", { exact: true }),
  ).toBeVisible();
  await expect(reviewRows(page)).toHaveCount(3);
  await expect(dialog.getByText("Bots take the coins back")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Block and reverse 3 transactions" })
    .click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(
      `Blocked ${TRADER_ID} everywhere and reversed 3 transactions.`,
    ),
  ).toBeVisible();
  await expect(await reversedOnDashboard(page)).toHaveCount(3);
});

test("an admin reversal over all time includes older trades", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const dialog = await startReversal(page);
  await dialog.getByLabel("All time").check();
  await reviewReversal(dialog);

  await expect(reviewRows(page)).toHaveCount(4);
  await expect(
    dialog.getByRole("button", { name: "Block and reverse 4 transactions" }),
  ).toBeVisible();
});

test("an owner must pick a direction, then reverses incoming trades", async ({
  page,
}) => {
  await openPage(page, "/owner");
  const dialog = await startReversal(page);
  await dialog.getByLabel("All time").check();
  await dialog.getByRole("button", { name: "Review reversal" }).click();

  const incoming = dialog.getByLabel("Incoming (into your currency)");
  await expect(incoming).toBeFocused();
  await expect(
    dialog.getByText("Pick which direction to reverse.").first(),
  ).toBeVisible();

  await incoming.check();
  await reviewReversal(dialog);
  await expect(reviewRows(page)).toHaveCount(2);
  await expect(reviewRows(page).first()).toContainText(PEBBLES_INTO_OATS);
  await expect(reviewRows(page).last()).toContainText(TICKETS_INTO_OATS);
  await dialog
    .getByRole("button", { name: "Block and reverse 2 transactions" })
    .click();

  await expect(dialog).toBeHidden();
  await expect(await reversedOnDashboard(page)).toHaveCount(2);
});

test("Back returns from the review to the filled form", async ({ page }) => {
  await openPage(page, "/admin");
  const dialog = await startReversal(page);
  await reviewReversal(dialog);
  await dialog.getByRole("button", { name: "Back" }).click();

  await expect(dialog.getByLabel("Discord user ID")).toHaveValue(TRADER_ID);
  await expect(
    dialog.getByLabel("Also reverse their completed transactions"),
  ).toBeChecked();
});

test("with the checkbox off, Block user blocks without a review", async ({
  page,
}) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Block a user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Discord user ID").fill(TRADER_ID);
  await dialog.getByLabel("Reason").fill("Laundered coins through alts.");
  await dialog.getByRole("button", { name: "Block user" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Review the reversal")).toHaveCount(0);
  await expect(await reversedOnDashboard(page)).toHaveCount(0);
});
