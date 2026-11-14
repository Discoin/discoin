import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  WCAG_22_AA_TAGS,
  openAdminReversalReview,
  openOwnerReversalReview,
  openPage,
} from "./support.js";

const PAGES = [
  { path: "/", title: "Discoin" },
  { path: "/transactions", title: "My transactions | Discoin" },
  { path: "/owner", title: "Bot owner | Discoin" },
  { path: "/admin", title: "Admin | Discoin" },
  { path: "/currency/OAT", title: "Oats (OAT) | Discoin" },
  { path: "/no-such-page", title: "Page not found | Discoin" },
];
const THEMES = ["light", "dark"] as const;

for (const { path } of PAGES) {
  for (const theme of THEMES) {
    test(`${path} meets WCAG 2.2 AA in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openPage(page, path);
      await page.evaluate(() => document.fonts.ready);

      const results = await new AxeBuilder({ page })
        .withTags(WCAG_22_AA_TAGS)
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }
}

test("the first Tab reaches the skip link, which moves focus to the content", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("the ticker can be paused and resumed without a mouse", async ({
  page,
}) => {
  await openPage(page, "/");
  const toggle = page.getByRole("button", { name: "Pause ticker" });
  const track = page.locator(".ticker__track");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(track).toHaveCSS("animation-play-state", "paused");

  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(track).toHaveCSS("animation-play-state", "running");
});

test("each page has its own title", async ({ page }) => {
  for (const { path, title } of PAGES) {
    await page.goto(path);
    await expect(page, path).toHaveTitle(title);
  }
});

test("pages reflow at 320px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });

  for (const { path } of PAGES) {
    await openPage(page, path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("confirming in place keeps keyboard focus in the right spot", async ({
  page,
}) => {
  await openPage(page, "/admin");
  const remove = page.getByRole("button", { name: "Remove ledgerbird" });

  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Keep admin" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(remove).toBeFocused();
});

test("removing a row moves focus to the button above it", async ({ page }) => {
  await openPage(page, "/owner");
  const unblock = page.getByRole("button", { name: /^Unblock/ });
  await unblock.focus();
  await page.keyboard.press("Enter");

  await expect(unblock).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Block a user" }),
  ).toBeFocused();
});

async function openBlockDialog(page: Page) {
  await page.getByRole("button", { name: "Block a user" }).click();
}

const DIALOG_STEPS = [
  {
    name: "admin edit form",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Edit OAT" }).click();
    },
  },
  {
    name: "admin edit review",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Edit OAT" }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Owner's Discord user ID")
        .fill("305918264730192845");
      await dialog.getByLabel("Weekly income median").fill("300000");
      await dialog.getByRole("button", { name: "Review changes" }).click();
    },
  },
  {
    name: "admin add form",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Add currency" }).click();
    },
  },
  { name: "admin block form", path: "/admin", open: openBlockDialog },
  { name: "owner block form", path: "/owner", open: openBlockDialog },
  {
    name: "admin reversal review",
    path: "/admin",
    open: openAdminReversalReview,
  },
  {
    name: "owner reversal review",
    path: "/owner",
    open: openOwnerReversalReview,
  },
];

for (const step of DIALOG_STEPS) {
  for (const theme of THEMES) {
    test(`the ${step.name} dialog meets WCAG 2.2 AA in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openPage(page, step.path);
      await step.open(page);
      await expect(page.getByRole("dialog")).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(WCAG_22_AA_TAGS)
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }

  test(`the ${step.name} dialog fits a 320px screen`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openPage(page, step.path);
    await step.open(page);
    const box = await page.getByRole("dialog").boundingBox();
    if (box === null) throw new Error("The dialog isn't rendered");

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });
}
