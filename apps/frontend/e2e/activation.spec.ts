import { expect, test, type Page } from "@playwright/test";

import { expectWcagCompliance, openPage, waitForData } from "./support.js";

const NEW_ADMIN_ID = "176254983017264999";

function overviewRow(page: Page, abbreviation: string) {
  return page
    .getByRole("table", { name: "All currencies" })
    .getByRole("row", { name: new RegExp(abbreviation) });
}

function editDialog(page: Page) {
  return page.getByRole("dialog", { name: "Edit Oats (OAT)" });
}

async function reviewStatusChange(page: Page) {
  await page.getByRole("button", { name: "Edit OAT" }).click();
  await editDialog(page).getByRole("switch", { name: "Active" }).click();
  await editDialog(page)
    .getByRole("button", { name: "Review changes" })
    .click();
}

async function deactivateOats(page: Page) {
  await openPage(page, "/admin");
  await reviewStatusChange(page);
  await editDialog(page)
    .getByRole("button", { name: "Deactivate and save" })
    .click();
  await expect(page.getByText("Saved OAT.")).toBeVisible();
}

async function goTo(page: Page, path: string) {
  await page.evaluate((target) => {
    history.pushState(null, "", target);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await waitForData(page);
}

test("the table shows the status but has no inline status button", async ({
  page,
}) => {
  await openPage(page, "/admin");

  await expect(overviewRow(page, "OAT")).toContainText("Active");
  await expect(
    page.getByRole("button", { name: /Deactivate|Reactivate/ }),
  ).toHaveCount(0);
});

test("turning Active off in Edit reviews the status and warns before saving", async ({
  page,
}) => {
  await openPage(page, "/admin");
  await reviewStatusChange(page);
  const dialog = editDialog(page);

  await expect(dialog.getByRole("definition")).toContainText("Inactive");
  await expect(dialog.getByText("This deactivates OAT")).toBeVisible();
  await dialog.getByRole("button", { name: "Deactivate and save" }).click();

  await expect(page.getByText("Saved OAT.")).toBeVisible();
  await expect(overviewRow(page, "OAT")).toContainText("Inactive");
});

test("flipping Active back leaves nothing to review", async ({ page }) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Edit OAT" }).click();
  const active = editDialog(page).getByRole("switch", { name: "Active" });
  await active.click();
  await active.click();

  await expect(
    editDialog(page).getByRole("button", { name: "Review changes" }),
  ).toBeDisabled();
});

test("an inactive currency leaves the table and ticker but keeps its page", async ({
  page,
}) => {
  await deactivateOats(page);
  await goTo(page, "/");

  const table = page.locator(".currency-table");
  await expect(table.getByText("OAT", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "Recent transactions" }),
  ).toBeVisible();

  await goTo(page, "/currency/OAT");
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(page.getByText("Trading is paused")).toBeVisible();
});

test("reactivating brings the currency back", async ({ page }) => {
  await deactivateOats(page);
  await reviewStatusChange(page);
  await editDialog(page).getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Saved OAT.").last()).toBeVisible();
  await expect(overviewRow(page, "OAT")).toContainText("Active");
});

test("an admin who never logged in shows by their user ID", async ({
  page,
}) => {
  await openPage(page, "/admin");
  await page.getByLabel("Discord user ID", { exact: true }).fill(NEW_ADMIN_ID);
  await page.getByRole("button", { name: "Make admin" }).click();

  await expect(
    page.getByText(`${NEW_ADMIN_ID} is now an admin.`),
  ).toBeVisible();
  const row = page
    .getByRole("table", { name: "Admins" })
    .getByRole("row", { name: new RegExp(NEW_ADMIN_ID) });
  await expect(row.getByRole("cell").first()).toHaveText(NEW_ADMIN_ID);
});

test("a currency code must be 3 or 4 letters", async ({ page }) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Add currency" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a currency" });
  const code = dialog.getByLabel("Abbreviation");

  await expect(code).toHaveAttribute("maxlength", "4");
  await dialog.getByLabel("Name").fill("Shells");
  await code.fill("S1");
  await dialog.getByLabel("Weekly income median").fill("50000");
  await dialog.getByLabel("Bot").selectOption({ label: "Harvest bot" });
  await dialog.getByRole("button", { name: "Add currency" }).click();

  await expect(code).toHaveAccessibleDescription(
    "Use 3 or 4 letters, A to Z, for the abbreviation.",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`the deactivation review meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPage(page, "/admin");
    await reviewStatusChange(page);
    await expect(
      editDialog(page).getByText("This deactivates OAT"),
    ).toBeVisible();

    await expectWcagCompliance(page);
  });

  test(`an inactive currency page meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await deactivateOats(page);
    await goTo(page, "/currency/OAT");

    await expectWcagCompliance(page);
  });
}
