import { afterEach, expect, test } from "vitest";

import {
  applyThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
} from "./theme.js";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("reads system when nothing is stored", () => {
  expect(readThemePreference()).toBe("system");
});

test("stores and applies an explicit theme", () => {
  applyThemePreference("dark");

  expect(readThemePreference()).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("clears the stored theme when going back to system", () => {
  applyThemePreference("light");
  applyThemePreference("system");

  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test("rejects an unknown stored theme", () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");

  expect(() => readThemePreference()).toThrow(/sepia/);
});
