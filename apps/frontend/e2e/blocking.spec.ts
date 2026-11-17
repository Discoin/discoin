import { expect, test, type Page } from "@playwright/test";

import { openPage, sidewaysOverflow } from "./support.js";

const NEW_BLOCK_ID = "700000000000000001";
const GLOBAL_BAN_IDS = ["198273645019283746", "587261093847562019"];
const BLOCK_PAGES = [
  { path: "/owner", title: "Block a user from Harvest bot" },
  { path: "/admin", title: "Block a user everywhere" },
];

function blockedRow(page: Page, userId: string) {
  return page
    .getByRole("table", { name: "Blocked users" })
    .getByRole("row", { name: new RegExp(userId) });
}

for (const { path, title } of BLOCK_PAGES) {
  test(`Block a user on ${path} opens a dialog that Esc and Close dismiss`, async ({
    page,
  }) => {
    await openPage(page, path);
    const opener = page.getByRole("button", { name: "Block a user" });
    const dialog = page.getByRole("dialog", { name: title });

    await opener.click();
    await expect(dialog.getByLabel("Discord user ID")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test(`blocking on ${path} needs a reason, which then shows in the list`, async ({
    page,
  }) => {
    await openPage(page, path);
    await page.getByRole("button", { name: "Block a user" }).click();
    const dialog = page.getByRole("dialog", { name: title });
    const reason = dialog.getByLabel("Reason");
    await dialog.getByLabel("Discord user ID").fill(NEW_BLOCK_ID);
    await reason.fill("   ");
    await dialog.getByRole("button", { name: "Block user" }).click();

    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(reason).toBeFocused();
    await expect(dialog.getByText("Enter a reason.").first()).toBeVisible();

    await reason.fill("Spammed trades.");
    await dialog.getByRole("button", { name: "Block user" }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(new RegExp(`^Blocked ${NEW_BLOCK_ID}`)),
    ).toBeVisible();
    await expect(blockedRow(page, NEW_BLOCK_ID)).toContainText(
      "Spammed trades.",
    );
  });
}

test("global bans show read-only on the owner page", async ({ page }) => {
  await openPage(page, "/owner");

  for (const userId of GLOBAL_BAN_IDS) {
    const row = blockedRow(page, userId);
    await expect(row).toContainText("Blocked by Discoin admins");
    await expect(row.getByRole("button")).toHaveCount(0);
  }
});

function blockedFrame(page: Page) {
  return page.getByRole("region", { name: "Blocked users table" });
}

test("on a phone the blocked users table scrolls inside its frame by keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openPage(page, "/admin");
  const frame = blockedFrame(page);

  expect(await sidewaysOverflow(frame)).toBeGreaterThan(0);
  await expect(frame).toHaveAttribute("tabindex", "0");
  await frame.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => frame.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
});
