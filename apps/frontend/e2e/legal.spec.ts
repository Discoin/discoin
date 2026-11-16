import { expect, test } from "@playwright/test";

import { openPage } from "./support.js";

const STORED_NAMES = [
  "discoin_login_state",
  "discoin_session",
  "discoin-theme",
];
const PAGE_NAME = "Privacy and cookies";

test("the footer link opens the Privacy and cookies page", async ({ page }) => {
  await openPage(page, "/");

  await page
    .getByRole("navigation", { name: "Legal" })
    .getByRole("link", { name: PAGE_NAME })
    .click();

  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole("heading", { level: 1, name: PAGE_NAME }),
  ).toBeVisible();
  await expect(page).toHaveTitle(`${PAGE_NAME} | Discoin`);
});

test("the page lists every cookie and storage key the site sets", async ({
  page,
}) => {
  await openPage(page, "/privacy");

  const table = page.getByRole("table", { name: "Cookies and storage" });

  for (const name of STORED_NAMES) {
    await expect(table.getByText(name, { exact: true })).toBeVisible();
  }
});

test("the page credits the policy it is adapted from", async ({ page }) => {
  await openPage(page, "/privacy");

  await expect(
    page.getByRole("link", { name: "Basecamp open-source policies" }),
  ).toHaveAttribute("href", "https://github.com/basecamp/policies");
  await expect(page.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
});
