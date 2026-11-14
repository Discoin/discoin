import { expect, test } from "@playwright/test";

import { openPage } from "./support.js";

test("the dashboard is the home page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Discoin exchange", level: 1 }),
  ).toBeVisible();
});

test("the logo wordmark is a home link named Discoin", async ({ page }) => {
  await page.goto("/currency/OAT");
  const home = page.getByRole("link", { name: "Discoin", exact: true });

  await expect(home).toHaveAttribute("href", "/");
  await home.click();
  await expect(
    page.getByRole("heading", { name: "Discoin exchange", level: 1 }),
  ).toBeVisible();
});

test("an unknown route shows the not found page", async ({ page }) => {
  await page.goto("/no-such-page");

  await expect(
    page.getByRole("heading", { name: "404: Not Found" }),
  ).toBeVisible();
});

test("the theme button cycles Auto, Light, Dark and back", async ({ page }) => {
  await openPage(page, "/");
  const theme = page.getByRole("button", { name: /^Theme:/ });
  const html = page.locator("html");

  await expect(theme).toHaveAccessibleName("Theme: Auto. Switch to Light.");
  await theme.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(theme).toHaveAccessibleName("Theme: Light. Switch to Dark.");
  await theme.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(theme).toHaveAccessibleName("Theme: Dark. Switch to Auto.");
  await theme.click();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
});

test("the theme choice survives a reload", async ({ page }) => {
  await openPage(page, "/");
  const theme = page.getByRole("button", { name: /^Theme:/ });
  await theme.click();
  await theme.click();
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(theme).toHaveAccessibleName("Theme: Dark. Switch to Auto.");
});

test("the theme button is at least 24 by 24 px", async ({ page }) => {
  await openPage(page, "/");
  const box = await page.getByRole("button", { name: /^Theme:/ }).boundingBox();
  if (box === null) throw new Error("The theme button isn't rendered");

  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
});

test("the calculator converts from whichever side you type in", async ({
  page,
}) => {
  await openPage(page, "/");
  const send = page.getByLabel("You send", { exact: true });
  const receive = page.getByLabel("They receive", { exact: true });

  await send.fill("1000");
  await expect(receive).toHaveValue("3,567.86");

  await receive.fill("3,567.86");
  await expect(send).toHaveValue("1,000.00");
});

test("swapping currencies keeps each amount with its currency", async ({
  page,
}) => {
  await openPage(page, "/");
  const send = page.getByLabel("You send", { exact: true });
  const receive = page.getByLabel("They receive", { exact: true });

  await send.fill("1000");
  await page.getByRole("button", { name: "Swap currencies" }).click();

  await expect(receive).toHaveValue("1000");
  await expect(page.getByLabel("They receive currency")).toHaveValue(/2c41/);
  await expect(send).toHaveValue("3,575.01");
});

test("a page served the prebuilt dashboard marks only its own nav link", async ({
  page,
}) => {
  const dashboardHtml = await (await page.request.get("/")).text();
  await page.route("**/admin", (route) =>
    route.fulfill({ contentType: "text/html", body: dashboardHtml }),
  );
  await openPage(page, "/admin");
  const nav = page.getByRole("navigation", { name: "Main" });

  await expect(nav.locator('[aria-current="page"]')).toHaveText(["Admin"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Admin");
});

test("a prebuilt page still marks its own nav link after loading", async ({
  page,
}) => {
  await openPage(page, "/");
  const nav = page.getByRole("navigation", { name: "Main" });

  await expect(nav.locator('[aria-current="page"]')).toHaveText(["Dashboard"]);
});
