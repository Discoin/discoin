export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_STORAGE_KEY = "discoin-theme";

function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function readThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === null) return "system";

  if (!isThemePreference(stored)) {
    throw new Error(
      `Unknown theme preference "${stored}" in localStorage key "${THEME_STORAGE_KEY}"`,
    );
  }

  return stored;
}

export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;

  if (preference === "system") {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    delete root.dataset.theme;

    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  root.dataset.theme = preference;
}
