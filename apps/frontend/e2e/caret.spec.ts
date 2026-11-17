import { devices, expect, test, type Locator } from "@playwright/test";

import { openPage } from "./support.js";

const USER_ID = "412358906715234305";
const MIDDLE = 6;

test.use({ ...devices["Pixel 7"] });

function caretOf(field: Locator) {
  return field.evaluate((input: HTMLInputElement) => input.selectionStart);
}

test("the caret follows typing in a Discord ID field on a phone", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await page.getByRole("button", { name: "Block a user" }).click();
  const field = page.getByRole("dialog").getByLabel("Discord user ID");
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
