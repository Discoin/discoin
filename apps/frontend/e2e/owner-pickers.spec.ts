import { expect, test, type Page } from "@playwright/test";

import { NO_ANSWER_MESSAGE } from "../src/lib/useAction.js";
import {
  boxOf,
  choosePickerOption,
  expectWcagCompliance,
  openPage,
  pageSidewaysOverflow,
  picker,
  sidewaysOverflow,
  startWithRenamesFindingCurrencyDeactivated,
  startWithRenamesLosingConnection,
  startWithStalledRenames,
  waitForData,
} from "./support.js";

const CHANGED_HOOK = "https://changed.example.com/hook";
const ZOOMED_VIEWPORT = { width: 320, height: 200 };

function webhookField(page: Page) {
  return page.getByLabel("Receipt webhook URL");
}

function currencyName(page: Page) {
  return page.getByLabel("Currency name", { exact: true });
}

function pickerStatus(page: Page, label: string) {
  return page
    .locator(".picker", { has: picker(page, label) })
    .getByRole("status");
}

async function pressOn(page: Page, label: string, keys: string[]) {
  await picker(page, label).focus();

  for (const key of keys) {
    await page.keyboard.press(key);
  }

  await waitForData(page);
}

test("the keyboard opens, closes and switches the currency, leaving the bot group in place", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await webhookField(page).fill(CHANGED_HOOK);
  await pressOn(page, "Currency", ["ArrowDown"]);
  await expect(page.getByRole("listbox", { name: "Currency" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(picker(page, "Currency")).toBeFocused();

  await pressOn(page, "Currency", ["ArrowDown", "ArrowDown", "Enter"]);

  await expect(currencyName(page)).toHaveValue("Scrap");
  await expect(webhookField(page)).toHaveValue(CHANGED_HOOK);
  await expect(picker(page, "Currency")).toBeFocused();
  await expect(pickerStatus(page, "Currency")).toHaveText(
    "Showing SCR (Scrap)",
  );
});

test("unsaved changes ask first; Escape and Keep editing stay, Switch discards, focus stays on the picker", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await webhookField(page).fill(CHANGED_HOOK);
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });

  await choosePickerOption(page, "Bot", "Ticket bot");
  await expect(dialog.getByText("Webhook URL")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep editing" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(picker(page, "Bot")).toBeFocused();

  await choosePickerOption(page, "Bot", "Ticket bot");
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(picker(page, "Bot")).toHaveText("Harvest bot");
  await expect(webhookField(page)).toHaveValue(CHANGED_HOOK);

  await choosePickerOption(page, "Bot", "Ticket bot");
  await dialog.getByRole("button", { name: "Switch to Ticket bot" }).click();
  await waitForData(page);
  await expect(dialog).toBeHidden();
  await expect(picker(page, "Bot")).toHaveText("Ticket bot");
  await expect(picker(page, "Bot")).toBeFocused();
  await expect(webhookField(page)).toHaveValue("");
});

test("the open list fits a zoomed 320 by 200 screen without sideways scrolling", async ({
  page,
}) => {
  await page.setViewportSize(ZOOMED_VIEWPORT);
  await openPage(page, "/owner");
  await picker(page, "Currency").click();
  const list = page.getByRole("listbox", { name: "Currency" });
  const box = await boxOf(list);

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(ZOOMED_VIEWPORT.width);
  expect(await sidewaysOverflow(list)).toBeLessThanOrEqual(0);
  expect(await pageSidewaysOverflow(page)).toBeLessThanOrEqual(0);

  await page.keyboard.press("End");
  await expect(
    list.getByRole("option", { name: "SCR Scrap" }),
  ).toBeInViewport();
});

async function renameSelectedCurrency(page: Page) {
  await currencyName(page).fill("Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
}

test("a currency deactivated while selected stays selected with a message", async ({
  page,
}) => {
  await startWithRenamesFindingCurrencyDeactivated(page);
  await openPage(page, "/owner");
  await webhookField(page).fill(CHANGED_HOOK);

  await renameSelectedCurrency(page);

  await expect(page.getByText("OAT is inactive")).toBeVisible();
  await expect(page.locator(".owner-group__message")).toBeFocused();
  await expect(currencyName(page)).toHaveCount(0);
  await expect(picker(page, "Currency")).toContainText("Inactive");
  await expect(webhookField(page)).toHaveValue(CHANGED_HOOK);

  await pressOn(page, "Currency", ["ArrowDown", "End", "Enter"]);

  await expect(currencyName(page)).toHaveValue("Scrap");
  await expect(picker(page, "Currency")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: "Currency: SCR (Scrap)" }),
  ).toBeFocused();
});

test("a save that got no answer says so and frees the pickers", async ({
  page,
}) => {
  await startWithRenamesLosingConnection(page);
  await openPage(page, "/owner");
  await renameSelectedCurrency(page);

  await expect(page.getByText(NO_ANSWER_MESSAGE)).toBeVisible();
  await expect(picker(page, "Bot")).not.toHaveAttribute("aria-disabled");
  await expect(currencyName(page)).toHaveValue("Renamed");

  await pressOn(page, "Bot", ["End", "Enter"]);
  await expect(
    page
      .getByRole("dialog", { name: "Discard unsaved changes?" })
      .getByText("Name and abbreviation"),
  ).toBeVisible();
});

test("a save that never answers keeps the pickers busy and focusable", async ({
  page,
}) => {
  await startWithStalledRenames(page);
  await openPage(page, "/owner");
  await renameSelectedCurrency(page);
  const bot = picker(page, "Bot");

  await expect(bot).toHaveAttribute("aria-disabled", "true");
  await expect(bot).toHaveAccessibleDescription(
    "Saving your changes. You can switch once the save finishes.",
  );
  await bot.evaluate((trigger) => trigger.scrollIntoView({ block: "center" }));
  const box = await boxOf(bot);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(bot).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`the deactivated currency with its list open meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await startWithRenamesFindingCurrencyDeactivated(page);
    await openPage(page, "/owner");
    await renameSelectedCurrency(page);
    await expect(page.getByText("OAT is inactive")).toBeVisible();
    await picker(page, "Currency").click();
    await expect(page.getByRole("listbox")).toBeVisible();

    await expectWcagCompliance(page);
  });

  test(`busy pickers during a save meet WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await startWithStalledRenames(page);
    await openPage(page, "/owner");
    await renameSelectedCurrency(page);
    await expect(picker(page, "Bot")).toHaveAttribute("aria-disabled", "true");

    await expectWcagCompliance(page);
  });
}

test("each option is at least 24 by 24 px", async ({ page }) => {
  await openPage(page, "/owner");
  await picker(page, "Currency").click();

  for (const option of await page.getByRole("option").all()) {
    const box = await boxOf(option);
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});
