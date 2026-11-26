import { expect, test, type Page } from "@playwright/test";

import {
  choosePickerOption,
  expectWcagCompliance,
  openPage,
} from "./support.js";

const HOOK_URL = "https://tickets-bot.example.com/discoin";

async function openTicketBot(page: Page) {
  await openPage(page, "/owner");
  await choosePickerOption(page, "Bot", "Ticket bot");
}

function webhookPanel(page: Page) {
  return page.getByRole("region", { name: "Webhook" });
}

function tokenPanel(page: Page) {
  return page.getByRole("region", { name: "API token" });
}

test("an existing token is never shown again", async ({ page }) => {
  await openPage(page, "/owner");
  const panel = tokenPanel(page);

  await expect(
    panel.getByText("Discoin only shows a token once, when it's made."),
  ).toBeVisible();
  await expect(panel.locator("code")).toHaveCount(0);
});

test("a regenerated token is shown once with a copy button", async ({
  page,
}) => {
  await openPage(page, "/owner");
  const panel = tokenPanel(page);
  await panel.getByRole("button", { name: "Regenerate API token" }).click();
  await panel.getByRole("button", { name: "Regenerate token" }).click();

  await expect(
    panel.getByText("Copy it now. Discoin only shows it once."),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: /Copy/ })).toBeVisible();
});

test("a webhook URL needs a secret first, shown on the URL field", async ({
  page,
}) => {
  await openTicketBot(page);
  const panel = webhookPanel(page);
  await panel.getByLabel("Receipt webhook URL").fill(HOOK_URL);
  await panel.getByRole("button", { name: "Save webhook" }).click();

  await expect(
    panel.getByLabel("Receipt webhook URL"),
  ).toHaveAccessibleDescription(
    /Generate a webhook secret first, so Discoin can sign each webhook./,
  );
});

test("generating a secret shows it once, then the URL saves", async ({
  page,
}) => {
  await openTicketBot(page);
  const panel = webhookPanel(page);
  await panel.getByRole("button", { name: "Generate webhook secret" }).click();

  await expect(
    page.getByText(
      "Webhook secret created. Copy it into your bot so it can check signatures.",
    ),
  ).toBeVisible();
  await expect(
    panel.getByText("Copy it now. Discoin only shows it once."),
  ).toBeVisible();

  await panel.getByLabel("Receipt webhook URL").fill(HOOK_URL);
  await panel.getByRole("button", { name: "Save webhook" }).click();
  await expect(
    page.getByText("Webhook saved. New transactions go to this URL."),
  ).toBeVisible();
});

test("regenerating the secret asks first and warns about signing", async ({
  page,
}) => {
  await openPage(page, "/owner");
  const panel = webhookPanel(page);
  await panel
    .getByRole("button", { name: "Regenerate Webhook secret" })
    .click();

  await expect(
    panel.getByText("The old secret stops signing right away.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Keep current secret" }),
  ).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`a freshly generated secret meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openTicketBot(page);
    await webhookPanel(page)
      .getByRole("button", { name: "Generate webhook secret" })
      .click();
    await expect(
      webhookPanel(page).getByText("Copy it now. Discoin only shows it once."),
    ).toBeVisible();

    await expectWcagCompliance(page);
  });
}

test("Test sends a test webhook, waits for the bot and says it passed", async ({
  page,
}) => {
  await openPage(page, "/owner");
  const test = webhookPanel(page).getByRole("button", { name: "Test webhook" });
  const status = webhookPanel(page).getByRole("status");

  await expect(test).toHaveText("Test webhook");
  await test.click();

  await expect(
    status.filter({
      hasText:
        "Your bot got the test. Waiting for it to mark the test Completed or Refunded.",
    }),
  ).toBeVisible();
  await expect(
    status.filter({
      hasText: "Test passed. Your bot marked the test Completed.",
    }),
  ).toBeVisible();
  await expectWcagCompliance(page);
});

test("Test without a webhook URL waits for the bot to read its event feed", async ({
  page,
}) => {
  await openTicketBot(page);
  const test = webhookPanel(page).getByRole("button", {
    name: "Test event feed",
  });
  const status = webhookPanel(page).getByRole("status");

  await expect(test).toHaveText("Test event feed");
  await test.click();

  await expect(
    status.filter({
      hasText:
        "Test event added to your event feed. Waiting for your bot to read it.",
    }),
  ).toBeVisible();
  await expect(
    status.filter({
      hasText: "Test passed. Your bot marked the test Completed.",
    }),
  ).toBeVisible();
});
