import { expect, test, type Locator, type Page } from "@playwright/test";

import { openPage, waitForData } from "./support.js";

const NEW_BLOCK_ID = "700000000000000001";
const GLOBAL_BAN_IDS = ["198273645019283746", "587261093847562019"];
const BLOCK_PAGES = [
  { path: "/owner", title: "Block a user from OAT" },
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

test("a bad user ID keeps the block dialog open with the error focused", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await page.getByRole("button", { name: "Block a user" }).click();
  const dialog = page.getByRole("dialog");
  const userId = dialog.getByLabel("Discord user ID");
  await userId.fill("12345");
  await dialog.getByLabel("Reason").fill("Spammed trades.");
  await dialog.getByRole("button", { name: "Block user" }).click();

  await expect(userId).toHaveAttribute("aria-invalid", "true");
  await expect(userId).toBeFocused();
});

for (const currency of ["OAT (Oats)", "TKT (Tickets)"]) {
  test(`global bans show read-only on the ${currency} owner page`, async ({
    page,
  }) => {
    await openPage(page, "/owner");
    await page
      .getByLabel("Currency", { exact: true })
      .selectOption({ label: currency });
    await waitForData(page);

    for (const userId of GLOBAL_BAN_IDS) {
      const row = blockedRow(page, userId);
      await expect(row).toContainText("Blocked by Discoin admins");
      await expect(row.getByRole("button")).toHaveCount(0);
    }
  });
}

function blockedFrame(page: Page) {
  return page.getByRole("region", { name: "Blocked users table" });
}

function sidewaysOverflow(frame: Locator) {
  return frame.evaluate((element) => element.scrollWidth - element.clientWidth);
}

for (const path of ["/admin", "/owner"]) {
  test(`the blocked users table fits without sideways scrolling on ${path} at 1280px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPage(page, path);

    expect(await sidewaysOverflow(blockedFrame(page))).toBeLessThanOrEqual(0);
  });

  test(`the blocked users table scrolls inside its frame on ${path} at 390px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openPage(page, path);
    const frame = blockedFrame(page);

    expect(await sidewaysOverflow(frame)).toBeGreaterThan(0);
    await expect(frame).toHaveAttribute("tabindex", "0");
    await frame.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => frame.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  });
}

test("Unblock buttons line up at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openPage(page, "/admin");
  const buttons = page
    .getByRole("table", { name: "Blocked users" })
    .getByRole("button", { name: /^Unblock/ });
  const boxes = await Promise.all(
    (await buttons.all()).map((button) => button.boundingBox()),
  );
  const lefts = boxes.map((box) => {
    if (box === null) throw new Error("An Unblock button isn't rendered");

    return box.x;
  });

  expect(lefts.length).toBeGreaterThan(1);
  expect(new Set(lefts).size).toBe(1);
});
