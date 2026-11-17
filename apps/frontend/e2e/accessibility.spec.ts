import { expect, test, type Page } from "@playwright/test";

import {
  NARROW_PHONE_VIEWPORT,
  PHONE_VIEWPORT,
  choosePickerOption,
  expectWcagCompliance,
  drawerApiDocs,
  drawerResources,
  failLogOutFromDrawer,
  logOutFromDrawer,
  openAdminReversalReview,
  openNavDrawer,
  openOwnerReversalReview,
  openPage,
  pageSidewaysOverflow,
  picker,
  sidewaysOverflow,
  startWithEveryCurrencyInactive,
  startWithFailingLogout,
} from "./support.js";

const PAGES = [
  { path: "/", title: "Discoin" },
  { path: "/transactions", title: "My transactions | Discoin" },
  {
    path: "/transactions/01989c4e-2f10-7a3b-9c41-5d7e0b8a2f61",
    title: "Transaction 8a2f61 | Discoin",
  },
  {
    path: "/transactions/01998f2a-4b70-7d19-8e36-c5a07b2d1f68",
    title: "Transaction 2d1f68 | Discoin",
  },
  {
    path: "/transactions/019a0000-0000-7000-8000-000000000000",
    title: "Page not found | Discoin",
  },
  { path: "/owner", title: "Bot owner | Discoin" },
  { path: "/admin", title: "Admin | Discoin" },
  { path: "/currency/OAT", title: "Oats (OAT) | Discoin" },
  { path: "/privacy", title: "Privacy and cookies | Discoin" },
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

      if (path === "/") {
        await expect(page.getByText("CRN (Corn, removed)")).toBeVisible();
      }

      await expectWcagCompliance(page);
    });
  }
}

for (const theme of THEMES) {
  test(`/ with no active currencies meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await startWithEveryCurrencyInactive(page);
    await openPage(page, "/");

    await expectWcagCompliance(page);
  });
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
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);

  for (const { path } of PAGES) {
    await openPage(page, path);

    expect(await pageSidewaysOverflow(page), path).toBeLessThanOrEqual(0);
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

async function openSwitchConfirmation(page: Page) {
  await page
    .getByLabel("Receipt webhook URL")
    .fill("https://changed.example.com/hook");
  await choosePickerOption(page, "Bot", "Ticket bot");
}

const PICKER_LABELS = ["Bot", "Currency"];

for (const theme of THEMES) {
  for (const label of PICKER_LABELS) {
    test(`the open ${label} picker on /owner meets WCAG 2.2 AA in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openPage(page, "/owner");
      await picker(page, label).focus();
      await page.keyboard.press("ArrowDown");

      await expect(picker(page, label)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expectWcagCompliance(page);
    });
  }
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
  {
    name: "admin bot assignment review",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Edit GEM" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Bot").selectOption({ label: "Harvest bot" });
      await dialog.getByLabel("Weekly income median").fill("30000");
      await dialog.getByRole("button", { name: "Review changes" }).click();
    },
  },
  {
    name: "admin add bot form",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Add bot" }).click();
    },
  },
  {
    name: "admin edit bot form",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Edit Harvest bot" }).click();
    },
  },
  {
    name: "admin currency removal",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Remove OAT" }).click();
      await page.getByRole("dialog").getByText("OAT (Oats)").waitFor();
    },
  },
  {
    name: "admin bot removal",
    path: "/admin",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Remove Rock bot" }).click();
      await page.getByRole("dialog").getByText("PBL (Pebbles)").waitFor();
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
  {
    name: "owner switch confirmation",
    path: "/owner",
    open: openSwitchConfirmation,
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

      await expectWcagCompliance(page);
    });
  }
}

test("every dialog fits a 320px screen", async ({ page }) => {
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);

  for (const step of DIALOG_STEPS) {
    await openPage(page, step.path);
    await step.open(page);
    const box = await page.getByRole("dialog").boundingBox();
    if (box === null) throw new Error(`The ${step.name} dialog isn't rendered`);

    expect(box.x, step.name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, step.name).toBeLessThanOrEqual(
      NARROW_PHONE_VIEWPORT.width,
    );
  }
});

const LOGIN_STATES = ["logged in", "logged out"] as const;
type LoginState = (typeof LOGIN_STATES)[number];

async function openHomeWithDrawer(page: Page, state: LoginState) {
  await openPage(page, "/");
  if (state === "logged out") await logOutFromDrawer(page);

  return await openNavDrawer(page);
}

for (const theme of THEMES) {
  for (const state of LOGIN_STATES) {
    test(`the menu drawer ${state} with Resources open meets WCAG 2.2 AA in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(PHONE_VIEWPORT);
      const drawer = await openHomeWithDrawer(page, state);
      await drawerResources(drawer).click();
      await expect(drawerApiDocs(drawer)).toBeVisible();

      await expectWcagCompliance(page);
    });
  }

  test(`the menu drawer with a logout error meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await startWithFailingLogout(page);
    await page.setViewportSize(PHONE_VIEWPORT);
    await openPage(page, "/");
    await failLogOutFromDrawer(page);

    await expectWcagCompliance(page);
  });

  test(`the open Resources menu meets WCAG 2.2 AA in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPage(page, "/");
    await page.getByRole("button", { name: "Resources" }).click();
    await expect(page.getByRole("link", { name: "API Docs" })).toBeVisible();

    await expectWcagCompliance(page);
  });
}

test("the open menu drawer reflows at 320px without sideways scrolling", async ({
  page,
}) => {
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);

  for (const state of LOGIN_STATES) {
    const drawer = await openHomeWithDrawer(page, state);

    expect(await pageSidewaysOverflow(page), state).toBeLessThanOrEqual(0);
    expect(await sidewaysOverflow(drawer), state).toBeLessThanOrEqual(0);
    expect(
      await sidewaysOverflow(drawer.locator(".nav-drawer__middle")),
      state,
    ).toBeLessThanOrEqual(0);
  }
});
