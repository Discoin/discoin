import { devices, expect, test } from "@playwright/test";

import { openPage } from "./support.js";

test.use({ ...devices["Pixel 7"] });

test("on a touch screen the ticker resumes after a second tap", async ({
  page,
}) => {
  await openPage(page, "/");
  const track = page.locator(".ticker__track");

  await page.getByRole("button", { name: "Pause ticker" }).tap();
  await expect(track).toHaveCSS("animation-play-state", "paused");

  await page.getByRole("button", { name: "Pause ticker" }).tap();
  await expect(track).toHaveCSS("animation-play-state", "running");
});

test("on a touch screen the pause button is always visible", async ({
  page,
}) => {
  await openPage(page, "/");
  const toggle = page.getByRole("button", { name: "Pause ticker" });
  const box = await toggle.boundingBox();
  if (box === null) throw new Error("The pause button isn't rendered");

  expect(box.width).toBeGreaterThanOrEqual(24);
});
