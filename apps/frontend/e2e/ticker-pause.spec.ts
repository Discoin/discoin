import { expect, test, type Locator, type Page } from "@playwright/test";

import { openPage } from "./support.js";

const MIN_TARGET_PX = 24;
const MAX_TABS = 10;

async function widthOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element isn't rendered");

  return box.width;
}

async function tabUntilFocused(page: Page, target: Locator): Promise<void> {
  for (let tab = 0; tab < MAX_TABS; tab += 1) {
    await page.keyboard.press("Tab");
    const focused = await target.evaluate(
      (el) => el === document.activeElement,
    );
    if (focused) return;
  }

  throw new Error(`Tab never reached the target in ${MAX_TABS} presses`);
}

test.describe("on a desktop with a mouse", () => {
  test("the pause button stays hidden until Tab reaches it", async ({
    page,
  }) => {
    await openPage(page, "/");
    const toggle = page.getByRole("button", { name: "Pause ticker" });
    const track = page.locator(".ticker__track");

    expect(await widthOf(toggle)).toBeLessThanOrEqual(1);

    await page.getByRole("link", { name: "Dashboard" }).focus();
    await tabUntilFocused(page, toggle);
    expect(await widthOf(toggle)).toBeGreaterThanOrEqual(MIN_TARGET_PX);

    await page.keyboard.press("Enter");
    await expect(track).toHaveCSS("animation-play-state", "paused");

    await page.keyboard.press("Enter");
    await expect(track).toHaveCSS("animation-play-state", "running");
  });

  test("hovering the ticker pauses it", async ({ page }) => {
    await openPage(page, "/");
    const track = page.locator(".ticker__track");

    await page.locator(".ticker__viewport").hover();

    await expect(track).toHaveCSS("animation-play-state", "paused");
  });
});
