import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { NO_ANSWER_MESSAGE } from "../src/lib/useAction.js";
import {
  NARROW_PHONE_VIEWPORT,
  WCAG_22_AA_TAGS,
  boxOf,
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
const LONG_BOT_NAME =
  "Harvest bot of the OatsAndScrapTradingGuildOfTheNorthernProvinces";

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

test("the owner page loads the first bot and its first currency", async ({
  page,
}) => {
  await openPage(page, "/owner");

  await expect(picker(page, "Bot")).toHaveText("Harvest bot");
  await expect(picker(page, "Currency")).toContainText("OAT");
  await expect(currencyName(page)).toHaveValue("Oats");
});

test("the keyboard switches the currency and leaves the bot group in place", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await webhookField(page).fill(CHANGED_HOOK);

  await pressOn(page, "Currency", ["ArrowDown", "ArrowDown", "Enter"]);

  await expect(currencyName(page)).toHaveValue("Scrap");
  await expect(webhookField(page)).toHaveValue(CHANGED_HOOK);
  await expect(picker(page, "Currency")).toBeFocused();
  await expect(pickerStatus(page, "Currency")).toHaveText(
    "Showing SCR (Scrap)",
  );
});

test("typing a bot's first letter switches the bot and resets the currency", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await pressOn(page, "Currency", ["ArrowDown", "End", "Enter"]);

  await pressOn(page, "Bot", ["t", "Enter"]);

  await expect(picker(page, "Bot")).toHaveText("Ticket bot");
  await expect(picker(page, "Currency")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: "Currency: TKT (Tickets)" }),
  ).toBeVisible();
  await expect(webhookField(page)).toHaveValue("");

  await pressOn(page, "Bot", ["Home", "Enter"]);
  await expect(currencyName(page)).toHaveValue("Oats");
});

test("Escape closes the list and keeps focus on the picker", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await picker(page, "Bot").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Bot" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(picker(page, "Bot")).toBeFocused();
});

test("choosing with the mouse keeps focus on the picker", async ({ page }) => {
  await openPage(page, "/owner");
  await picker(page, "Currency").click();
  await page.getByRole("option", { name: "SCR Scrap" }).click();

  await expect(picker(page, "Currency")).toBeFocused();
  await expect(currencyName(page)).toHaveValue("Scrap");
});

test("a click outside closes the list without choosing", async ({ page }) => {
  await openPage(page, "/owner");
  await picker(page, "Currency").click();
  await page.getByRole("heading", { level: 1 }).click();

  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(currencyName(page)).toHaveValue("Oats");
});

test("unsaved changes ask first; staying keeps them and the picker focus", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await webhookField(page).fill(CHANGED_HOOK);
  await picker(page, "Bot").click();
  await page.getByRole("option", { name: "Ticket bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });

  await expect(dialog.getByText("Webhook URL")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep editing" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(picker(page, "Bot")).toBeFocused();
  await expect(picker(page, "Bot")).toHaveText("Harvest bot");
  await expect(webhookField(page)).toHaveValue(CHANGED_HOOK);
});

test("unsaved changes ask first; switching discards them", async ({ page }) => {
  await openPage(page, "/owner");
  await currencyName(page).fill("Rolled oats");
  await pressOn(page, "Currency", ["ArrowDown", "ArrowDown", "Enter"]);
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });

  await expect(dialog.getByText("Name and abbreviation")).toBeVisible();
  await dialog.getByRole("button", { name: "Switch to SCR (Scrap)" }).click();
  await waitForData(page);

  await expect(dialog).toBeHidden();
  await expect(picker(page, "Currency")).toBeFocused();
  await expect(currencyName(page)).toHaveValue("Scrap");
});

test("a saved rename updates the picker", async ({ page }) => {
  await openPage(page, "/owner");
  await currencyName(page).fill("Rolled oats");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(picker(page, "Currency")).toContainText("Rolled oats");
  await expect(pickerStatus(page, "Currency")).toHaveText("");
});

test("the pickers stack full width at 320px", async ({ page }) => {
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);
  await openPage(page, "/owner");
  const bot = await boxOf(picker(page, "Bot"));
  const currency = await boxOf(picker(page, "Currency"));

  expect(currency.y).toBeGreaterThan(bot.y);
  expect(currency.width).toBeCloseTo(bot.width, 0);
  expect(await pageSidewaysOverflow(page)).toBeLessThanOrEqual(0);
});

for (const viewport of [NARROW_PHONE_VIEWPORT, ZOOMED_VIEWPORT]) {
  test(`the open list fits a ${viewport.width}x${viewport.height} screen without sideways scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openPage(page, "/owner");
    await picker(page, "Currency").click();
    const list = page.getByRole("listbox", { name: "Currency" });
    const box = await boxOf(list);

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await sidewaysOverflow(list)).toBeLessThanOrEqual(0);
    expect(await pageSidewaysOverflow(page)).toBeLessThanOrEqual(0);

    await page.keyboard.press("End");
    await expect(
      list.getByRole("option", { name: "SCR Scrap" }),
    ).toBeInViewport();
  });
}

test("a long bot name wraps inside the picker at 320px", async ({ page }) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Edit Harvest bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Harvest bot" });
  await dialog.getByLabel("Bot name").fill(LONG_BOT_NAME);
  await dialog.getByRole("button", { name: "Save bot" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: "Bot owner" }).click();
  await waitForData(page);
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);
  const trigger = picker(page, "Bot");
  const box = await boxOf(trigger);

  await expect(trigger).toHaveText(LONG_BOT_NAME);
  expect(await sidewaysOverflow(trigger)).toBeLessThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(NARROW_PHONE_VIEWPORT.width);
  expect(await pageSidewaysOverflow(page)).toBeLessThanOrEqual(0);
});

async function renameSelectedCurrency(page: Page) {
  await currencyName(page).fill("Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
}

async function expectWcagCompliance(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_22_AA_TAGS)
    .analyze();

  expect(results.violations).toEqual([]);
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

test("a bot's only currency deactivated while selected shows the message", async ({
  page,
}) => {
  await startWithRenamesFindingCurrencyDeactivated(page);
  await openPage(page, "/owner");
  await pressOn(page, "Bot", ["t", "Enter"]);

  await renameSelectedCurrency(page);

  await expect(page.getByText("TKT is inactive")).toBeVisible();
  await expect(picker(page, "Currency")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Currency: TKT (Tickets), inactive",
    }),
  ).toBeVisible();
});

test("the pickers are busy while a save is sent and free again after", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await currencyName(page).fill("Rolled oats");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(picker(page, "Bot")).toHaveAttribute("aria-disabled", "true");
  await expect(picker(page, "Bot")).not.toHaveAttribute("aria-disabled");
  await expect(picker(page, "Currency")).toContainText("Rolled oats");
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

test("a shown API token asks before a bot switch until it's dismissed", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await page.getByRole("button", { name: "Regenerate API token" }).click();
  await page.getByRole("button", { name: "Regenerate token" }).click();
  await expect(page.getByText("Copy it now.", { exact: false })).toBeVisible();

  await pressOn(page, "Bot", ["End", "Enter"]);
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(dialog.getByText("API token")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "I've copied the token" }).click();
  await pressOn(page, "Bot", ["End", "Enter"]);

  await expect(dialog).toHaveCount(0);
  await expect(picker(page, "Bot")).toHaveText("Ticket bot");
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
