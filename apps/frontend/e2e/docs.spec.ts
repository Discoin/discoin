import { expect, test, type Locator, type Page } from "@playwright/test";

import { ENDPOINT_GROUPS } from "../src/pages/Docs/endpoints.js";
import { expectOnDocsPage, openPage } from "./support.js";

const NODE_MARKER = "isSignedByDiscoin";
const PYTHON_MARKER = "is_signed_by_discoin";
const WINDOWS_LINE_BREAK = "\r\n";

function sample(page: Page, name: string): Locator {
  return page.getByRole("group", { name, exact: true });
}

async function copiedText(page: Page, sampleName: string): Promise<string> {
  await sample(page, sampleName).getByRole("button", { name: /^Copy/ }).click();
  await expect(page.getByText(`${sampleName} copied.`)).toBeAttached();

  const copied = await page.evaluate(() => navigator.clipboard.readText());

  return copied.split(WINDOWS_LINE_BREAK).join("\n");
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("the footer link opens the API docs page", async ({ page }) => {
  await openPage(page, "/");
  await page
    .getByRole("navigation", { name: "Site links" })
    .getByRole("link", { name: "API docs" })
    .click();

  await expectOnDocsPage(page);
});

test("the page documents every endpoint and the signature header", async ({
  page,
}) => {
  await openPage(page, "/docs");

  for (const group of ENDPOINT_GROUPS) {
    for (const { method, path } of group.endpoints) {
      await expect(
        page.getByRole("heading", {
          level: 3,
          name: `${method} ${path}`,
          exact: true,
        }),
      ).toBeVisible();
    }
  }

  await expect(page.getByText("Discoin-Signature").first()).toBeVisible();
});

test("the docs page shows no price ticker", async ({ page }) => {
  await openPage(page, "/docs");

  await expect(page.locator(".ticker")).toHaveCount(0);
  await expect(page.locator(".site-header__ticker-note")).toHaveCount(0);
});

test("an endpoint with no parameters and no errors shows no empty table or list", async ({
  page,
}) => {
  await openPage(page, "/docs");
  const endpoint = page.getByRole("region", {
    name: "GET /currencies",
    exact: true,
  });

  await expect(endpoint.getByRole("table")).toHaveCount(0);
  await expect(endpoint.getByRole("heading", { name: "Errors" })).toHaveCount(
    0,
  );
});

test("Copy puts exactly the visible sample on the clipboard", async ({
  page,
}) => {
  await openPage(page, "/docs");
  const name = "POST /transactions request";

  expect(await copiedText(page, name)).toBe(
    await sample(page, name).locator("pre").textContent(),
  );
});

test("a section link scrolls to its section", async ({ page }) => {
  await openPage(page, "/docs");
  await page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "Webhooks" })
    .click();

  await expect(page).toHaveURL(/#webhooks$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Webhooks" }),
  ).toBeInViewport();
});

test("an unknown anchor leaves the page at the top", async ({ page }) => {
  await page.goto("/docs#no-such-section");

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("the prerendered page shows the Node.js signature check", async ({
  page,
}) => {
  const html = await (await page.request.get("/docs")).text();

  expect(html).toContain(NODE_MARKER);
  expect(html).not.toContain(PYTHON_MARKER);
  expect(html).not.toContain("v1=");
  expect(html).toMatch(/<input[^>]*type="radio"[^>]*value="node"[^>]*checked/);
});

test("the keyboard switches the signature check language and Copy follows it", async ({
  page,
}) => {
  await openPage(page, "/docs");
  const node = page.getByRole("radio", { name: "Node.js" });
  const python = page.getByRole("radio", { name: "Python" });

  await expect(node).toBeChecked();
  await expect(sample(page, "Node.js signature check")).toContainText(
    NODE_MARKER,
  );

  await node.focus();
  await page.keyboard.press("ArrowDown");
  await expect(python).toBeChecked();
  await expect(python).toBeFocused();
  await expect(sample(page, "Node.js signature check")).toHaveCount(0);
  expect(await copiedText(page, "Python signature check")).toContain(
    PYTHON_MARKER,
  );

  await python.focus();
  await page.keyboard.press("ArrowUp");
  await expect(node).toBeChecked();
  await expect(node).toBeFocused();
  await expect(sample(page, "Node.js signature check")).toContainText(
    NODE_MARKER,
  );
  await expect(
    sample(page, "Node.js signature check").getByRole("button"),
  ).toHaveAccessibleName("Copy Node.js signature check");
});
