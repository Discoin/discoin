import { expect, test, type Locator } from "@playwright/test";

import { openPage, startReversal } from "./support.js";

function labelOf(input: Locator) {
  return input.locator("xpath=ancestor::label[1]");
}

test("checkboxes, radios and their labels show the pointer cursor", async ({
  page,
}) => {
  await openPage(page, "/owner");
  const dialog = await startReversal(page);
  const checkbox = dialog.getByLabel(
    "Also reverse their completed transactions",
  );
  const radio = dialog.getByLabel("All time");

  for (const target of [checkbox, labelOf(checkbox), radio, labelOf(radio)]) {
    await expect(target).toHaveCSS("cursor", "pointer");
  }
});

test("a disabled checkbox and its label show the not-allowed cursor", async ({
  page,
}) => {
  await openPage(page, "/owner");
  const dialog = await startReversal(page);
  const checkbox = dialog.getByLabel(
    "Also reverse their completed transactions",
  );
  await checkbox.evaluate((input: HTMLInputElement) => {
    input.disabled = true;
  });

  await expect(checkbox).toBeDisabled();
  await expect(checkbox).toHaveCSS("cursor", "not-allowed");
  await expect(labelOf(checkbox)).toHaveCSS("cursor", "not-allowed");
});

test("checking a box and picking a radio still works from the keyboard", async ({
  page,
}) => {
  await openPage(page, "/owner");
  await page.getByRole("button", { name: "Block a user" }).click();
  const dialog = page.getByRole("dialog");
  const checkbox = dialog.getByLabel(
    "Also reverse their completed transactions",
  );
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();

  const incoming = dialog.getByLabel("Incoming (into your currency)");
  await incoming.focus();
  await page.keyboard.press("Space");
  await expect(incoming).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(
    dialog.getByLabel("Outgoing (out of your currency)"),
  ).toBeChecked();
});
