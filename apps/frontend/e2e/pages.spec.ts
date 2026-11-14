import { expect, test } from "@playwright/test";

import { openPage } from "./support.js";

test("my transactions lists only the user's own trades", async ({ page }) => {
  await openPage(page, "/transactions");

  await expect(
    page.getByRole("table", { name: "My transactions" }).locator("tbody tr"),
  ).toHaveCount(4);
});

test("a taken abbreviation is shown on the field", async ({ page }) => {
  await openPage(page, "/owner");
  await page.getByLabel("Abbreviation", { exact: true }).fill("PBL");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(
    page.getByLabel("Abbreviation", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(
    page
      .getByText("PBL is taken by another currency", { exact: false })
      .first(),
  ).toBeVisible();
});
