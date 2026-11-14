import { expect, test, type Page } from "@playwright/test";

import { openPage } from "./support.js";

const CURRENT_USER_ID = "412358906715234305";
const OTHER_USER_ID = "305918264730192845";

function overviewRow(page: Page, abbreviation: string) {
  return page
    .getByRole("table", { name: "All currencies" })
    .getByRole("row", { name: new RegExp(abbreviation) });
}

async function openEdit(page: Page, abbreviation: string) {
  await page.getByRole("button", { name: `Edit ${abbreviation}` }).click();

  return page.getByRole("dialog");
}

test("Edit opens a dialog focused on its first field, and Esc returns focus", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const edit = page.getByRole("button", { name: "Edit OAT" });

  await edit.click();
  const dialog = page.getByRole("dialog", { name: "Edit Oats (OAT)" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Owner's Discord user ID")).toBeFocused();

  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
});

test("Review changes stays off until something changes", async ({ page }) => {
  await openPage(page, "/admin");
  const dialog = await openEdit(page, "OAT");
  const review = dialog.getByRole("button", { name: "Review changes" });

  await expect(review).toBeDisabled();
  await dialog.getByLabel("Weekly income median").fill("300000");
  await expect(review).toBeEnabled();
});

test("an owner change shows old and new IDs, then moves the currency", async ({
  page,
}) => {
  await openPage(page, "/admin");
  let dialog = await openEdit(page, "OAT");
  await dialog.getByLabel("Owner's Discord user ID").fill(OTHER_USER_ID);
  await dialog.getByRole("button", { name: "Review changes" }).click();

  await expect(dialog.getByText("Review OAT changes")).toBeFocused();
  await expect(dialog.getByRole("definition")).toContainText(CURRENT_USER_ID);
  await expect(dialog.getByRole("definition")).toContainText(OTHER_USER_ID);
  await expect(dialog.locator(".edit-review__changed").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("Saved OAT.")).toBeVisible();
  await expect(overviewRow(page, "OAT")).toContainText(OTHER_USER_ID);

  dialog = await openEdit(page, "GEM");
  await dialog.getByLabel("Owner's Discord user ID").fill(CURRENT_USER_ID);
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(overviewRow(page, "GEM")).toContainText(CURRENT_USER_ID);

  await page.getByRole("link", { name: "Bot owner" }).click();

  await expect(
    page.getByLabel("Currency", { exact: true }).locator("option"),
  ).toHaveText(["GEM (Gems)", "TKT (Tickets)"]);
});

test("a median change warns about the reserve before saving", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const dialog = await openEdit(page, "OAT");
  await dialog.getByLabel("Weekly income median").fill("300000");
  await dialog.getByRole("button", { name: "Review changes" }).click();

  await expect(
    dialog.getByText("The OAT reserve goes to 1,200,000.00.", { exact: false }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Reset reserve and save" }).click();

  await expect(overviewRow(page, "OAT")).toContainText("1,200,000.00");
  await expect(overviewRow(page, "OAT")).toContainText("300,000.00");
});

test("a bad owner ID returns to the form with the error focused", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const dialog = await openEdit(page, "OAT");
  await dialog.getByLabel("Owner's Discord user ID").fill("12345");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();

  const owner = dialog.getByLabel("Owner's Discord user ID");
  await expect(owner).toBeFocused();
  await expect(owner).toHaveAttribute("aria-invalid", "true");
});

test("Add currency opens a dialog, and the new currency reaches its owner", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const add = page.getByRole("button", { name: "Add currency" });

  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add a currency" });
  await expect(dialog.getByLabel("Currency name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();

  await add.click();
  await dialog.getByLabel("Currency name").fill("Shells");
  await dialog.getByLabel("Abbreviation").fill("SHL");
  await dialog.getByLabel("Weekly income median").fill("50000");
  await dialog.getByLabel("Bot owner's Discord user ID").fill(CURRENT_USER_ID);
  await dialog.getByRole("button", { name: "Add currency" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Added Shells (SHL).")).toBeVisible();
  await expect(overviewRow(page, "SHL")).toBeVisible();

  await page.getByRole("link", { name: "Bot owner" }).click();

  await expect(
    page.getByLabel("Currency", { exact: true }).locator("option"),
  ).toContainText(["OAT (Oats)", "TKT (Tickets)", "SHL (Shells)"]);
});
