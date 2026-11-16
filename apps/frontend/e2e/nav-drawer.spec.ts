import { expect, test, type Locator, type Page } from "@playwright/test";

import { LATENCY_MS } from "../src/mocks/api.js";
import {
  DESKTOP_VIEWPORT,
  NARROW_PHONE_VIEWPORT,
  PHONE_VIEWPORT,
  boxOf,
  drawerApiDocs,
  drawerBrand,
  drawerResources,
  expectLeftForApiDocs,
  logOutFromDrawer,
  menuButton,
  navDrawer,
  openNavDrawer,
  openPage,
  pageSidewaysOverflow,
  sidewaysOverflow,
  stubApiDocs,
} from "./support.js";

const SHORT_VIEWPORT = { width: 320, height: 200 };
const JUST_ABOVE_PINNED_FOOTER_MIN = { width: 360, height: 520 };
const BACKDROP_STRIP_MIN_PX = 40;
const STRIP_POINT = { x: 8, y: 150 };
const WHEEL_DISTANCE_PX = 800;
const MIN_TARGET_PX = 24;
const TABS_PAST_THE_END = 12;
const FLUSHES_BEFORE_SESSION_CHECK = 2;
const EFFECTS_FLUSH_MS = LATENCY_MS / (FLUSHES_BEFORE_SESSION_CHECK + 1);
const SLIDE_ANIMATION = "nav-drawer-slide-in";

const LOGGED_IN_FOCUS_ORDER = [
  "Dashboard",
  "My transactions",
  "Bot owner",
  "Admin",
  "Resources",
  "Log out",
];

async function openPhonePage(page: Page, path: string) {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openPage(page, path);
}

function closeButton(drawer: Locator) {
  return drawer.getByRole("button", { name: "Close menu" });
}

async function expectFocusedName(page: Page, name: string) {
  await expect(page.locator(":focus")).toHaveAccessibleName(name);
}

function expectTargetSize(box: { width: number; height: number }) {
  expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
}

function focusIsInsideDrawerOrNowhere(page: Page) {
  return page.evaluate(() => {
    const focused = document.activeElement;
    const dialog = document.querySelector("dialog.nav-drawer");

    return focused === document.body || dialog?.contains(focused) === true;
  });
}

function focusedIsFullyInView(page: Page) {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return false;

    const box = focused.getBoundingClientRect();
    const inView =
      box.top >= 0 &&
      box.left >= 0 &&
      box.bottom <= window.innerHeight &&
      box.right <= window.innerWidth;
    const onTop = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );

    return inView && onTop !== null && focused.contains(onTop);
  });
}

function scrollTop(page: Page) {
  return page.evaluate(() => window.scrollY);
}

function rootOverflow(page: Page) {
  return page.evaluate(
    () => getComputedStyle(document.documentElement).overflow,
  );
}

function afterTwoFrames(page: Page) {
  return page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function wheelOverStrip(page: Page) {
  await page.mouse.move(STRIP_POINT.x, STRIP_POINT.y);
  await page.mouse.wheel(0, WHEEL_DISTANCE_PX);
}

test("the menu button opens a drawer named Menu with focus on its close button", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  const menu = menuButton(page);

  expectTargetSize(await boxOf(menu));
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  const drawer = await openNavDrawer(page);

  const drawerId = await drawer.getAttribute("id");
  if (drawerId === null) throw new Error("The drawer has no id");

  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toHaveAttribute("aria-controls", drawerId);
  await expect(closeButton(drawer)).toBeFocused();
});

test("the drawer slides in, and opens without motion when reduced motion is asked for", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  let drawer = await openNavDrawer(page);

  await expect(drawer).toHaveCSS("animation-name", SLIDE_ANIMATION);
  await page.keyboard.press("Escape");
  await expect(navDrawer(page)).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  drawer = await openNavDrawer(page);
  await expect(drawer).toHaveCSS("animation-name", "none");
});

test("logged in, focus runs brand, close, Main links, Resources, then Log out", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  const drawer = await openNavDrawer(page);

  await page.keyboard.press("Shift+Tab");
  await expect(drawerBrand(drawer)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton(drawer)).toBeFocused();

  for (const name of LOGGED_IN_FOCUS_ORDER) {
    await page.keyboard.press("Tab");
    await expectFocusedName(page, name);
  }
});

test("logged out, focus runs close, Log in, Dashboard, then Resources, with no Log out", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  await logOutFromDrawer(page);
  const drawer = await openNavDrawer(page);

  await expect(closeButton(drawer)).toBeFocused();

  for (const name of ["Log in with Discord", "Dashboard", "Resources"]) {
    await page.keyboard.press("Tab");
    await expectFocusedName(page, name);
  }

  await expect(drawer.getByRole("button", { name: "Log out" })).toHaveCount(0);
});

test("the drawer stacks every item without overlap, each at least 24 by 24 px", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  const drawer = await openNavDrawer(page);
  await drawerResources(drawer).click();
  const close = closeButton(drawer);
  const dashboard = drawer.getByRole("link", { name: "Dashboard" });
  const logout = drawer.getByRole("button", { name: "Log out" });
  const stacked = [
    drawerBrand(drawer),
    drawer.locator(".nav-drawer__user"),
    drawer.getByRole("separator"),
    dashboard,
    drawer.getByRole("link", { name: "Admin" }),
    drawerResources(drawer),
    drawerApiDocs(drawer),
    logout,
  ];
  const boxes = await Promise.all(stacked.map(boxOf));

  for (const [index, box] of boxes.slice(1).entries()) {
    const above = boxes[index];
    expect(above.y + above.height).toBeLessThanOrEqual(box.y);
  }

  const targets = [
    close,
    dashboard,
    drawerResources(drawer),
    drawerApiDocs(drawer),
    logout,
  ];
  for (const target of targets) {
    expectTargetSize(await boxOf(target));
  }
});

test("the brand link in the drawer goes home and closes the drawer, also on the home page", async ({
  page,
}) => {
  await openPhonePage(page, "/currency/OAT");
  let drawer = await openNavDrawer(page);
  const brand = drawerBrand(drawer);

  await expect(brand).toHaveAttribute("href", "/");
  await brand.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(navDrawer(page)).toHaveCount(0);

  drawer = await openNavDrawer(page);
  await drawerBrand(drawer).click();
  await expect(navDrawer(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("following a Main link opens that page and closes the drawer", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  const drawer = await openNavDrawer(page);
  await drawer.getByRole("link", { name: "My transactions" }).click();

  await expect(page).toHaveURL(/\/transactions$/);
  await expect(navDrawer(page)).toHaveCount(0);
  await openNavDrawer(page);
  await expect(navDrawer(page).locator('[aria-current="page"]')).toHaveText([
    "My transactions",
  ]);
});

test("Dashboard closes the drawer even on the dashboard itself", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  const drawer = await openNavDrawer(page);
  await drawer.getByRole("link", { name: "Dashboard" }).click();

  await expect(navDrawer(page)).toHaveCount(0);
});

test("Escape closes the whole drawer with Resources open and Resources starts collapsed again", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  let drawer = await openNavDrawer(page);
  await drawerResources(drawer).click();
  await expect(drawerResources(drawer)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await drawerApiDocs(drawer).focus();
  await page.keyboard.press("Escape");

  await expect(navDrawer(page)).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");

  drawer = await openNavDrawer(page);
  await expect(drawerResources(drawer)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(drawerApiDocs(drawer)).toHaveCount(0);
});

test("the close button closes the drawer and returns focus to the menu button", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  const drawer = await openNavDrawer(page);
  await closeButton(drawer).click();

  await expect(navDrawer(page)).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();
});

test("at 320px a strip of backdrop stays visible and clicking it closes the drawer", async ({
  page,
}) => {
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);
  await openPage(page, "/");
  const drawer = await openNavDrawer(page);
  const box = await boxOf(drawer);

  expect(box.x).toBeGreaterThanOrEqual(BACKDROP_STRIP_MIN_PX);
  expect(box.x + box.width).toBeLessThanOrEqual(NARROW_PHONE_VIEWPORT.width);
  await page.mouse.click(STRIP_POINT.x, STRIP_POINT.y);
  await expect(navDrawer(page)).toHaveCount(0);
});

test("the page behind the open drawer cannot be focused or scrolled", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  await openNavDrawer(page);
  const theme = page.locator(".theme-toggle");

  await theme.focus();
  await expect(theme).not.toBeFocused();

  for (let step = 0; step < TABS_PAST_THE_END; step++) {
    await page.keyboard.press("Tab");
    expect(await focusIsInsideDrawerOrNowhere(page)).toBe(true);
  }

  expect(await rootOverflow(page)).toBe("hidden");
  await wheelOverStrip(page);
  await afterTwoFrames(page);
  expect(await scrollTop(page)).toBe(0);

  await page.keyboard.press("Escape");
  await expect(navDrawer(page)).toHaveCount(0);
  await wheelOverStrip(page);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
});

test("API Docs in the drawer leaves the app for Swagger in the same tab", async ({
  page,
}) => {
  const documentRequests = await stubApiDocs(page);
  await openPhonePage(page, "/");
  const drawer = await openNavDrawer(page);
  await drawerResources(drawer).click();
  const docs = drawerApiDocs(drawer);

  await expect(docs).toHaveAttribute("href", "/api/docs");
  await docs.click();
  await expectLeftForApiDocs(page, documentRequests);
});

test("widening to desktop closes the drawer and frees the page", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  await openNavDrawer(page);
  await page.setViewportSize(DESKTOP_VIEWPORT);

  await expect(navDrawer(page)).toHaveCount(0);
  const admin = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Admin" });
  await expect(admin).toBeVisible();
  await admin.focus();
  await expect(admin).toBeFocused();
  expect(await rootOverflow(page)).not.toBe("hidden");
  await page.mouse.move(
    DESKTOP_VIEWPORT.width / 2,
    DESKTOP_VIEWPORT.height / 2,
  );
  await page.mouse.wheel(0, WHEEL_DISTANCE_PX);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
});

test("Log out stays pinned to the bottom edge while the middle scrolls", async ({
  page,
}) => {
  await page.setViewportSize(JUST_ABOVE_PINNED_FOOTER_MIN);
  await openPage(page, "/");
  const drawer = await openNavDrawer(page);
  await drawerResources(drawer).click();
  const middle = drawer.locator(".nav-drawer__middle");
  const footer = drawer.locator(".nav-drawer__foot");
  const logout = drawer.getByRole("button", { name: "Log out" });

  await expect(middle).toHaveCSS("overflow-y", "auto");
  const before = await boxOf(footer);
  expect(before.y + before.height).toBeCloseTo(
    JUST_ABOVE_PINNED_FOOTER_MIN.height,
    0,
  );
  await middle.evaluate((element, height) => {
    const manyMoreLinks = document.createElement("div");
    manyMoreLinks.style.height = `${height}px`;
    element.append(manyMoreLinks);
    element.scrollTop = element.scrollHeight;
  }, JUST_ABOVE_PINNED_FOOTER_MIN.height);
  expect(await middle.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  expect(await boxOf(footer)).toEqual(before);
  await expect(logout).toBeInViewport({ ratio: 1 });
  expect(await drawer.evaluate((element) => element.scrollTop)).toBe(0);
});

test("the Main links stay put while the session loads", async ({ page }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + LATENCY_MS);
  await page.goto("/");
  await page.clock.runFor(EFFECTS_FLUSH_MS);
  await menuButton(page).click();
  await page.clock.runFor(EFFECTS_FLUSH_MS);
  const drawer = navDrawer(page);
  const account = drawer.locator(".nav-drawer__account");
  const dashboard = drawer.getByRole("link", { name: "Dashboard" });

  await expect(account).toBeEmpty();
  await expect(drawer.getByRole("button", { name: "Log out" })).toHaveCount(0);
  const loading = await boxOf(dashboard);

  await page.clock.resume();
  await expect(drawer.locator(".nav-drawer__user")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Log out" })).toBeVisible();
  expect((await boxOf(dashboard)).y).toBe(loading.y);
});

test("logged in and logged out, the Main links start at the same height", async ({
  page,
}) => {
  await openPhonePage(page, "/");
  let drawer = await openNavDrawer(page);
  const loggedIn = await boxOf(drawer.getByRole("link", { name: "Dashboard" }));
  await closeButton(drawer).click();
  await logOutFromDrawer(page);
  drawer = await openNavDrawer(page);

  expect((await boxOf(drawer.getByRole("link", { name: "Dashboard" }))).y).toBe(
    loggedIn.y,
  );
});

test.describe("below the pinned footer height", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(SHORT_VIEWPORT);
    await openPage(page, "/");
  });

  test("the whole drawer scrolls as one region and focus stays fully in view", async ({
    page,
  }) => {
    const drawer = await openNavDrawer(page);

    await expect(drawer).toHaveCSS("overflow-y", "auto");
    await expect(drawer.locator(".nav-drawer__middle")).toHaveCSS(
      "overflow-y",
      "visible",
    );
    await page.keyboard.press("Shift+Tab");
    expect(await focusedIsFullyInView(page)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await focusedIsFullyInView(page)).toBe(true);

    for (const name of LOGGED_IN_FOCUS_ORDER) {
      await page.keyboard.press("Tab");
      await expectFocusedName(page, name);
      expect(await focusedIsFullyInView(page), name).toBe(true);
    }
  });

  test("nothing scrolls sideways with the drawer open", async ({ page }) => {
    const drawer = await openNavDrawer(page);

    expect(await pageSidewaysOverflow(page)).toBeLessThanOrEqual(0);
    expect(await sidewaysOverflow(drawer)).toBeLessThanOrEqual(0);
  });

  test("Escape, the close button and the backdrop strip still close it", async ({
    page,
  }) => {
    await openNavDrawer(page);
    await page.keyboard.press("Escape");
    await expect(navDrawer(page)).toHaveCount(0);

    const drawer = await openNavDrawer(page);
    await drawer.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await closeButton(drawer).click();
    await expect(navDrawer(page)).toHaveCount(0);

    await openNavDrawer(page);
    await page.mouse.click(STRIP_POINT.x, STRIP_POINT.y);
    await expect(navDrawer(page)).toHaveCount(0);
  });
});
