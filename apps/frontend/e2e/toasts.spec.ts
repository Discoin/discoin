import { expect, test, type Page } from "@playwright/test";

import { TOAST_DURATION_MS } from "../src/lib/toasts.js";
import { PHONE_VIEWPORT, expectWcagCompliance, openPage } from "./support.js";

const MIN_TARGET_PX = 24;

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

test("a toast shows in the status region, never takes focus and closes on its 24 by 24 px close button", async ({
  page,
}) => {
  await showWebhookToast(page);
  const shown = toast(page, "Webhook saved.");
  const close = shown.getByRole("button", { name: "Close notification" });

  await expect(toastRegion(page)).toHaveAttribute("role", "status");
  await expect(shown).toBeVisible();
  const focusInToast = await page.evaluate(
    () => document.activeElement?.closest(".toaster") !== null,
  );
  expect(focusInToast).toBe(false);
  const box = await close.boundingBox();
  if (box === null) throw new Error("The close button isn't rendered");

  expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  await close.click();
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

test("toasts stack inside a phone screen", async ({ page }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await showWebhookToast(page);
  await expect(toast(page, "Webhook saved.")).toBeVisible();
  await saveWebhook(page);
  await expect(toastRegion(page).locator(".toast")).toHaveCount(2);
  const boxes = await Promise.all(
    (await toastRegion(page).locator(".toast").all()).map((shown) =>
      shown.boundingBox(),
    ),
  );

  for (const box of boxes) {
    if (box === null) throw new Error("A toast isn't rendered");

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`a showing toast meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await showWebhookToast(page);
    await expect(toast(page, "Webhook saved.")).toBeVisible();

    await expectWcagCompliance(page);
  });
}
