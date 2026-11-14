import { expect, test, type Page } from "@playwright/test";

import { openOwnerReversalReview, openPage } from "./support.js";

const SHARED_LINES = [
  ".ticker__item",
  ".data-table tbody tr",
  ".secret-field__row",
];
const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 360;
const HEADER_LINE: Record<number, string> = {
  [DESKTOP_WIDTH]: ".site-header__bar",
  [PHONE_WIDTH]: ".site-header__nav",
};
const GLYPHS = ".price-change__glyph";
const TOLERANCE_PX = 1;
const LINE_GAP_PX = 10;

function baselineSpreads(page: Page, width: number) {
  const lines = [...SHARED_LINES, HEADER_LINE[width]];

  return page.evaluate(
    ({ lines, glyphs, lineGap }) => {
      const spreads: { line: string; spread: number }[] = [];

      for (const line of document.querySelectorAll(lines.join(","))) {
        const markers: HTMLElement[] = [];

        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (!node.textContent?.trim() || parent === null) continue;
          if (parent.closest(`.visually-hidden, ${glyphs}`)) continue;

          const marker = document.createElement("span");
          marker.style.cssText = "display:inline-block;width:0;height:0";
          parent.insertBefore(marker, node);
          markers.push(marker);
        }

        const baselines = markers
          .map((m) => m.getBoundingClientRect().bottom)
          .sort((a, b) => a - b);
        markers.forEach((marker) => marker.remove());

        const rows: number[][] = [];

        for (const baseline of baselines) {
          const row = rows.find((r) => baseline - r[0] < lineGap);
          if (row === undefined) rows.push([baseline]);
          else row.push(baseline);
        }

        for (const row of rows) {
          spreads.push({
            line: line.textContent?.trim().slice(0, 40) ?? "",
            spread: row[row.length - 1] - row[0],
          });
        }
      }

      return spreads;
    },
    { lines, glyphs: GLYPHS, lineGap: LINE_GAP_PX },
  );
}

async function expectSharedBaselines(page: Page, width: number) {
  await page.evaluate(() => document.fonts.ready);

  for (const { line, spread } of await baselineSpreads(page, width)) {
    expect(spread, line).toBeLessThanOrEqual(TOLERANCE_PX);
  }
}

for (const width of [DESKTOP_WIDTH, PHONE_WIDTH]) {
  for (const path of [
    "/",
    "/transactions",
    "/owner",
    "/admin",
    "/currency/OAT",
  ]) {
    test(`text on one line shares a baseline on ${path} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPage(page, path);
      await expectSharedBaselines(page, width);
    });
  }

  test(`text on one line shares a baseline in the reversal review at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPage(page, "/owner");
    await openOwnerReversalReview(page);
    await expectSharedBaselines(page, width);
  });
}
