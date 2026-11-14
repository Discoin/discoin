import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { TOAST_DURATION_MS } from "../src/lib/toasts.js";
import { WCAG_22_AA_TAGS, openPage } from "./support.js";

function toastRegion(page: Page) {
  return page.locator(".toaster");
}

function toast(page: Page, message: string) {
  return toastRegion(page).locator(".toast", { hasText: message });
}

function saveWebhookButton(page: Page) {
  return page.getByRole("button", { name: "Save webhook" });
}

async function saveWebhook(page: Page) {
  await expect(saveWebhookButton(page)).toBeEnabled();
  await saveWebhookButton(page).click();
}

async function showWebhookToast(page: Page) {
  await openPage(page, "/owner");
  await saveWebhook(page);
}

test("the toast region is a status region on every page load", async ({
  page,
}) => {
  await openPage(page, "/");

  await expect(toastRegion(page)).toHaveAttribute("role", "status");
  await expect(toastRegion(page)).toBeEmpty();
});

test("saving a currency shows a toast in the status region", async ({
  page,
}) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Edit OAT" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Weekly income median").fill("300000");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await dialog.getByRole("button", { name: "Reset reserve and save" }).click();

  await expect(toast(page, "Saved OAT.")).toBeVisible();
});

test("adding a currency shows a toast", async ({ page }) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Add currency" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Currency name").fill("Shells");
  await dialog.getByLabel("Abbreviation").fill("SHL");
  await dialog.getByLabel("Weekly income median").fill("50000");
  await dialog
    .getByLabel("Bot owner's Discord user ID")
    .fill("412358906715234305");
  await dialog.getByRole("button", { name: "Add currency" }).click();

  await expect(toast(page, "Added Shells (SHL).")).toBeVisible();
});

test("blocking a user shows a toast", async ({ page }) => {
  await openPage(page, "/owner");
  await page.getByRole("button", { name: "Block a user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Discord user ID").fill("700000000000000001");
  await dialog.getByLabel("Reason").fill("Spammed trades.");
  await dialog.getByRole("button", { name: "Block user" }).click();

  await expect(
    toast(page, "Blocked 700000000000000001 from OAT."),
  ).toBeVisible();
});

test("an error stays inline and never shows a toast", async ({ page }) => {
  await openPage(page, "/owner");
  await page.getByRole("button", { name: "Block a user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Block user" }).click();

  await expect(dialog.getByLabel("Discord user ID")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(toastRegion(page)).toBeEmpty();
});

test("a toast never takes focus and closes on its close button", async ({
  page,
}) => {
  await showWebhookToast(page);
  const shown = toast(page, "Webhook saved.");

  await expect(shown).toBeVisible();
  const focusInToast = await page.evaluate(
    () => document.activeElement?.closest(".toaster") !== null,
  );
  expect(focusInToast).toBe(false);

  await shown.getByRole("button", { name: "Close notification" }).click();
  await expect(shown).toHaveCount(0);
});

test("a toast disappears after its timeout", async ({ page }) => {
  await page.clock.install();
  await showWebhookToast(page);
  const shown = toast(page, "Webhook saved.");
  await expect(shown).toBeVisible();

  await page.clock.fastForward(TOAST_DURATION_MS);

  await expect(shown).toHaveCount(0);
});

test("a hovered toast stays past its timeout", async ({ page }) => {
  await page.clock.install();
  await showWebhookToast(page);
  const shown = toast(page, "Webhook saved.");
  await shown.hover();

  await page.clock.fastForward(TOAST_DURATION_MS * 2);

  await expect(shown).toBeVisible();
});

test("the close button is at least 24 by 24 px", async ({ page }) => {
  await showWebhookToast(page);
  const box = await toast(page, "Webhook saved.")
    .getByRole("button", { name: "Close notification" })
    .boundingBox();
  if (box === null) throw new Error("The close button isn't rendered");

  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
});

for (const width of [360, 1280]) {
  test(`toasts stack inside a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await showWebhookToast(page);
    await expect(toast(page, "Webhook saved.")).toBeVisible();
    await saveWebhook(page);
    await expect(toastRegion(page).locator(".toast")).toHaveCount(2);
    const boxes = await Promise.all(
      (await toastRegion(page).locator(".toast").all()).map((shown) =>
        shown.boundingBox(),
      ),
    );

    expect(boxes).toHaveLength(2);

    for (const box of boxes) {
      if (box === null) throw new Error("A toast isn't rendered");

      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`a showing toast meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await showWebhookToast(page);
    await expect(toast(page, "Webhook saved.")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
