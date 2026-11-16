import {
  devices,
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

import { openPage } from "./support.js";

const USER_ID = "412358906715234305";
const MIDDLE = 6;

test.use({ ...devices["Pixel 7"] });

const ID_FIELDS = [
  {
    name: "add bot owner",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Add bot" }).click();

      return page.getByRole("dialog").getByLabel("Owner ID");
    },
  },
  {
    name: "edit bot owner",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Edit Harvest bot" }).click();
      const field = page.getByRole("dialog").getByLabel("Owner ID");
      await field.fill("");

      return field;
    },
  },
  {
    name: "admin block",
    path: "/admin",
    open: openBlockField,
  },
  {
    name: "owner block",
    path: "/owner",
    open: openBlockField,
  },
];

async function openBlockField(page: Page) {
  await page.getByRole("button", { name: "Block a user" }).click();

  return page.getByRole("dialog").getByLabel("Discord user ID");
}

function caretOf(field: Locator) {
  return field.evaluate((input: HTMLInputElement) => input.selectionStart);
}

for (const { name, path, open } of ID_FIELDS) {
  test(`the caret follows typing in the ${name} ID field`, async ({ page }) => {
    await openPage(page, path);
    const field = await open(page);
    await field.click();

    for (const [index, digit] of [...USER_ID].entries()) {
      await page.keyboard.type(digit);
      expect(await caretOf(field), `after digit ${index + 1}`).toBe(index + 1);
    }

    await field.evaluate(
      (input: HTMLInputElement, at) => input.setSelectionRange(at, at),
      MIDDLE,
    );
    await page.keyboard.type("9");

    await expect(field).toHaveValue(
      `${USER_ID.slice(0, MIDDLE)}9${USER_ID.slice(MIDDLE)}`,
    );
    expect(await caretOf(field)).toBe(MIDDLE + 1);
  });
}
