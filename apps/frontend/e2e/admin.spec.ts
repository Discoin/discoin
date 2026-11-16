import { expect, test, type Page } from "@playwright/test";

import {
  choosePickerOption,
  expectPickerOptions,
  openPage,
  picker,
  waitForData,
} from "./support.js";

const CURRENT_USER_ID = "412358906715234305";
const OTHER_USER_ID = "305918264730192845";

function overviewRow(page: Page, abbreviation: string) {
  return page
    .getByRole("table", { name: "All currencies" })
    .getByRole("row", { name: new RegExp(abbreviation) });
}

function botRow(page: Page, name: string) {
  return page
    .getByRole("table", { name: "Bots" })
    .getByRole("row", { name: new RegExp(name) });
}

async function openEdit(page: Page, abbreviation: string) {
  await page.getByRole("button", { name: `Edit ${abbreviation}` }).click();

  return page.getByRole("dialog");
}

test("Edit opens a dialog focused on its first field, and Esc returns focus", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const edit = page.getByRole("button", { name: "Edit OAT" });

  await edit.click();
  const dialog = page.getByRole("dialog", { name: "Edit Oats (OAT)" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Weekly income median")).toBeFocused();

  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
});

test("Review changes stays off until something changes", async ({ page }) => {
  await openPage(page, "/admin");
  const dialog = await openEdit(page, "OAT");
  const review = dialog.getByRole("button", { name: "Review changes" });

  await expect(review).toBeDisabled();
  await dialog.getByLabel("Weekly income median").fill("300000");
  await expect(review).toBeEnabled();
});

test("a botless currency gets its bot once, then reaches the bot's owner", async ({
  page,
}) => {
  await openPage(page, "/admin");
  await expect(overviewRow(page, "GEM")).toContainText("No bot");
  let dialog = await openEdit(page, "GEM");
  await dialog.getByLabel("Bot").selectOption({ label: "Harvest bot" });
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByText("Saved GEM. Moved 1 block to Harvest bot."),
  ).toBeVisible();
  await expect(overviewRow(page, "GEM")).toContainText("Harvest bot");

  dialog = await openEdit(page, "GEM");
  await expect(dialog.getByLabel("Bot")).toHaveCount(0);
  await expect(dialog.getByText("Harvest bot")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Bot owner" }).click();
  await waitForData(page);

  await expectPickerOptions(page, "Currency", [
    "GEM Gems",
    "OAT Oats",
    "SCR Scrap",
  ]);
  await expect(picker(page, "Currency")).toContainText("Gems");

  await expect(page.getByRole("heading", { name: "API token" })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /481920374650192837/ }),
  ).toBeVisible();
});

test("a currency that has a bot shows it as text, with no bot field", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const dialog = await openEdit(page, "OAT");

  await expect(dialog.getByLabel("Bot")).toHaveCount(0);
  await expect(dialog.getByText("Harvest bot")).toBeVisible();
});

test("a median change warns about the reserve before saving", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const dialog = await openEdit(page, "OAT");
  await dialog.getByLabel("Weekly income median").fill("300000");
  await dialog.getByRole("button", { name: "Review changes" }).click();

  await expect(
    dialog.getByText("The OAT reserve goes to 1,200,000.00.", { exact: false }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Reset reserve and save" }).click();

  await expect(overviewRow(page, "OAT")).toContainText("1,200,000.00");
  await expect(overviewRow(page, "OAT")).toContainText("300,000.00");
});

test("a bad median returns to the form with the error focused", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const dialog = await openEdit(page, "OAT");
  await dialog.getByLabel("Weekly income median").fill("-5");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await dialog.getByRole("button", { name: "Reset reserve and save" }).click();

  const median = dialog.getByLabel("Weekly income median");
  await expect(median).toBeFocused();
  await expect(median).toHaveAttribute("aria-invalid", "true");
});

test("Add currency opens a dialog, and the new currency reaches its owner", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const add = page.getByRole("button", { name: "Add currency" });

  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add a currency" });
  await expect(dialog.getByLabel("Currency name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();

  await add.click();
  await dialog.getByLabel("Currency name").fill("Shells");
  await dialog.getByLabel("Abbreviation").fill("SHL");
  await dialog.getByLabel("Weekly income median").fill("50000");
  await dialog.getByLabel("Bot").selectOption({ label: "Ticket bot" });
  await dialog.getByRole("button", { name: "Add currency" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Added Shells (SHL).")).toBeVisible();
  await expect(overviewRow(page, "SHL")).toBeVisible();

  await page.getByRole("link", { name: "Bot owner" }).click();
  await waitForData(page);
  await choosePickerOption(page, "Bot", "Ticket bot");

  await expectPickerOptions(page, "Currency", ["SHL Shells", "TKT Tickets"]);
});

test("a new currency needs a bot", async ({ page }) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Add currency" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a currency" });
  await dialog.getByLabel("Currency name").fill("Shells");
  await dialog.getByLabel("Abbreviation").fill("SHL");
  await dialog.getByLabel("Weekly income median").fill("50000");
  await dialog.getByRole("button", { name: "Add currency" }).click();

  const bot = dialog.getByLabel("Bot");
  await expect(bot).toHaveAttribute("aria-invalid", "true");
  await expect(bot).toHaveAccessibleDescription(
    "Pick the bot that runs this currency.",
  );
});

test("an admin registers a bot and then picks it for a new currency", async ({
  page,
}) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Add bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a bot" });
  await expect(dialog.getByLabel("Bot name")).toBeFocused();
  await dialog.getByLabel("Bot name").fill("Shell bot");
  await dialog.getByLabel("Bot's Discord ID").fill("990000000000000009");
  await dialog.getByLabel("Owner ID").fill(CURRENT_USER_ID);
  await dialog.getByRole("button", { name: "Add bot" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved Shell bot.")).toBeVisible();
  await expect(botRow(page, "Shell bot")).toContainText("990000000000000009");

  await page.getByRole("button", { name: "Add currency" }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Bot").locator("option"),
  ).toContainText(["Shell bot"]);
});

test("editing a bot's owner says the token and webhook are cleared", async ({
  page,
}) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Edit Harvest bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Harvest bot" });
  const owner = dialog.getByLabel("Owner ID");

  await expect(owner).toHaveAccessibleDescription(
    /clears the bot's API token, webhook URL and webhook secret/,
  );
  await owner.fill(OTHER_USER_ID);
  await dialog.getByRole("button", { name: "Save bot" }).click();

  await expect(dialog).toBeHidden();
  await expect(botRow(page, "Harvest bot")).toContainText(OTHER_USER_ID);
});

test("removing a currency lists what happens, then frees its abbreviation", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const remove = page.getByRole("button", { name: "Remove OAT" });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Remove Oats (OAT)?" });

  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(dialog.getByText("OAT (Oats)")).toBeVisible();
  await expect(dialog.getByText(/2 transactions still Pending/)).toBeVisible();
  await expect(dialog.getByText("This can't be undone")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();

  await remove.click();
  await dialog.getByRole("button", { name: "Remove currency" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Removed Oats (OAT).")).toBeVisible();
  await expect(overviewRow(page, "OAT")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "All currencies" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Add currency" }).click();
  const add = page.getByRole("dialog", { name: "Add a currency" });
  await add.getByLabel("Currency name").fill("New oats");
  await add.getByLabel("Abbreviation").fill("OAT");
  await add.getByLabel("Weekly income median").fill("50000");
  await add.getByLabel("Bot").selectOption({ label: "Harvest bot" });
  await add.getByRole("button", { name: "Add currency" }).click();
  await expect(page.getByText("Added New oats (OAT).")).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(
    page
      .getByRole("table", { name: "Recent transactions" })
      .getByText("OAT (Oats, removed)")
      .first(),
  ).toBeVisible();
});

test("removing a bot lists its currencies, blocks and the token", async ({
  page,
}) => {
  await openPage(page, "/admin");
  await page.getByRole("button", { name: "Remove Rock bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove Rock bot?" });

  await expect(dialog.getByText("PBL (Pebbles)")).toBeVisible();
  await expect(dialog.getByText("SCR (Scrap)")).toHaveCount(0);
  await expect(dialog.getByText("0 blocks will stop")).toBeVisible();
  await expect(dialog.getByText(/token and webhook stop/)).toBeVisible();
  await dialog.getByRole("button", { name: "Remove bot" }).click();

  await expect(dialog).toBeHidden();
  await expect(botRow(page, "Rock bot")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add bot" })).toBeFocused();
  await expect(overviewRow(page, "PBL")).toHaveCount(0);
  await expect(overviewRow(page, "SCR")).toHaveCount(1);
});
