import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { WCAG_22_AA_TAGS, openPage } from "./support.js";

function regenerate(page: Page) {
  return page.getByRole("button", { name: "Regenerate API token" });
}

test("Regenerate asks first and warns the old token stops working", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await regenerate(page).click();

  await expect(
    page.getByText("The old token stops working right away.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep current token" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Keep current token" }).click();
  await expect(regenerate(page)).toBeFocused();
});

test("confirming Regenerate replaces the token and says so", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await regenerate(page).click();
  await page.getByRole("button", { name: "Regenerate token" }).click();

  await expect(
    page.getByText("Token regenerated. Update your bot with the new one."),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`the Regenerate confirm meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPage(page, "/owner");
    await expect(regenerate(page)).toHaveClass(/button--danger/);
    await regenerate(page).click();
    await page.evaluate(() => document.fonts.ready);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
