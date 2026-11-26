import { expect, test } from "@playwright/test";

import { expectOnDocsPage, openPage } from "../e2e/support.js";

test("the dashboard lists the seeded currencies from the API", async ({
  page,
}) => {
  const answered = page.waitForResponse(
    (response) => response.url().endsWith("/api/currencies") && response.ok(),
  );
  await openPage(page, "/");
  await answered;

  const table = page.getByRole("table", { name: "Currencies" });
  await expect(table.getByText("Oats")).toBeVisible();
  await expect(table.getByText("Tickets")).toBeVisible();
});

test("a currency page loads its quote, chart and trades from the API", async ({
  page,
}) => {
  await openPage(page, "/currency/OAT");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Oats");
  await expect(page.getByRole("region", { name: "OAT value" })).toBeVisible();
  await expect(page.getByText("No trades yet")).toBeVisible();
});

test("Resources opens the API docs page, and the API serves no Swagger UI", async ({
  page,
}) => {
  await openPage(page, "/");
  await page.getByRole("button", { name: "Resources" }).click();
  await page.getByRole("link", { name: "API Docs", exact: true }).click();

  await expectOnDocsPage(page);
  expect((await page.request.get("/api/docs")).status()).toBe(404);
  expect((await page.request.get("/api/openapi.json")).ok()).toBe(true);
});

test("logged out visitors are offered Discord login on gated pages", async ({
  page,
}) => {
  await openPage(page, "/owner");

  await expect(
    page.getByRole("main").getByRole("link", { name: "Log in with Discord" }),
  ).toHaveAttribute("href", "/api/auth/discord/login?next=%2Fowner");
});
