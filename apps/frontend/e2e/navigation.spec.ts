import { expect, test } from "@playwright/test";

test("home page renders the getting started heading", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Get Started building/ }),
  ).toBeVisible();
});

test("navigating to an unknown route shows the not found page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "404" }).click();

  await expect(
    page.getByRole("heading", { name: "404: Not Found" }),
  ).toBeVisible();
});
