import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { WCAG_22_AA_TAGS, openPage, waitForData } from "./support.js";

const TICKETS_ID = "019a6f12-3a9c-7f45-8e70-b6215d0c3a18";
const HOOK_URL = "https://tickets-bot.example.com/discoin";

async function openTickets(page: Page) {
  await openPage(page, "/owner");
  await page.getByLabel("Currency", { exact: true }).selectOption(TICKETS_ID);
  await waitForData(page);
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
  await openTickets(page);
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
  await openTickets(page);
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
    await openTickets(page);
    await webhookPanel(page)
      .getByRole("button", { name: "Generate webhook secret" })
      .click();
    await expect(
      webhookPanel(page).getByText("Copy it now. Discoin only shows it once."),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test("Test sends a test webhook and says how the endpoint answered", async ({
  page,
}) => {
  await openPage(page, "/owner");
  const test = webhookPanel(page).getByRole("button", { name: "Test webhook" });

  await expect(test).toHaveText("Test webhook");
  await test.click();

  await expect(
    page.getByText("Test sent. Your webhook answered 200."),
  ).toBeVisible();
});

test("Test only shows once a webhook URL is saved", async ({ page }) => {
  await openTickets(page);

  await expect(
    webhookPanel(page).getByRole("button", { name: "Test webhook" }),
  ).toHaveCount(0);
});
