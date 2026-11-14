import { expect, test } from "@playwright/test";

import { openPage, waitForData } from "./support.js";

test("clicking anywhere on a currency row opens its page", async ({ page }) => {
  await openPage(page, "/");
  const valueCell = page
    .getByRole("row", { name: /TKT/ })
    .getByRole("cell")
    .nth(1);
  const box = await valueCell.boundingBox();
  if (box === null) throw new Error("The TKT value cell isn't on screen");

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page).toHaveURL(/\/currency\/TKT$/);
  await waitForData(page);
  await expect(
    page.getByRole("heading", { level: 1, name: /Tickets/ }),
  ).toBeVisible();
});

test("a currency link in the table works from the keyboard", async ({
  page,
}) => {
  await openPage(page, "/");
  const link = page
    .getByRole("table", { name: "Currencies" })
    .getByRole("link", { name: /PBL/ });

  await link.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/currency\/PBL$/);
});

test("the chart range switch redraws the chart", async ({ page }) => {
  await openPage(page, "/currency/OAT");
  const week = page.getByRole("button", { name: /^7D/ });

  await week.click();

  await expect(week).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("figure", { name: "OAT value, last 7 days" }),
  ).toBeVisible();
});

test("the calculator on a currency page starts from that currency", async ({
  page,
}) => {
  await openPage(page, "/currency/SCR");

  await expect(page.getByLabel("You send currency")).toHaveValue(/0b13/);
});

test("an unknown currency says so and links back", async ({ page }) => {
  await openPage(page, "/currency/NOPE");

  await expect(page.getByText("No currency called NOPE")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to the dashboard" }),
  ).toBeVisible();
});

test("keyboard focus on the ticker shows a still list of links", async ({
  page,
}) => {
  await openPage(page, "/");
  await page.getByRole("button", { name: "Pause ticker" }).focus();
  await page.keyboard.press("Tab");

  const focused = page.locator(".ticker__static a").first();
  await expect(focused).toBeFocused();
  await expect(focused).toBeVisible();
  await expect(page.locator(".ticker__viewport")).toBeHidden();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/currency\/OAT$/);
});

test("clicking a ticker item opens that currency's page with its data", async ({
  page,
}) => {
  await openPage(page, "/");
  const item = page.locator(".ticker__track a", { hasText: "SCR" }).first();
  const box = await item.boundingBox();
  if (box === null) throw new Error("The SCR ticker item isn't rendered");

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page).toHaveURL(/\/currency\/SCR$/);
  await waitForData(page);
  await expect(
    page.getByRole("heading", { level: 1, name: /Scrap/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("figure", { name: "SCR value, last 30 days" }),
  ).toBeVisible();
});

test("loading any currency page directly shows its data", async ({ page }) => {
  for (const abbreviation of ["OAT", "TKT", "gem"]) {
    await openPage(page, `/currency/${abbreviation}`);

    await expect(
      page.getByRole("heading", { level: 1 }),
      abbreviation,
    ).toContainText(abbreviation.toUpperCase());
    await expect(
      page.getByRole("heading", { name: "404: Not Found" }),
    ).toHaveCount(0);
  }
});
