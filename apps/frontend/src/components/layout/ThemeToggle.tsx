import { useEffect, useState } from "preact/hooks";
import {
  applyThemePreference,
  readThemePreference,
  THEME_PREFERENCES,
  type ThemePreference,
} from "../../lib/theme.js";
import "./ThemeToggle.scss";

const LABELS: Record<ThemePreference, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

const ICON_PATHS: Record<ThemePreference, string> = {
  system: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zm0 2v14a7 7 0 0 1 0-14z",
  light:
    "M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4.2 5.6l1.4-1.4l2.9 2.8l-1.5 1.5zM15.5 17l1.5-1.5l2.8 2.9l-1.4 1.4zM4.2 18.4L7 15.5L8.5 17l-2.9 2.8zM15.5 7l2.9-2.8l1.4 1.4L17 8.5z",
  dark: "M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z",
};

function nextPreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current);

  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length];
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const next = nextPreference(preference);
  const label = `Theme: ${LABELS[preference]}. Switch to ${LABELS[next]}.`;

  useEffect(() => {
    setPreference(readThemePreference());
  }, []);

  function switchTheme() {
    applyThemePreference(next);
    setPreference(next);
  }

  return (
    <button
      type="button"
      class="theme-toggle"
      aria-label={label}
      title={label}
      onClick={switchTheme}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d={ICON_PATHS[preference]} />
      </svg>
    </button>
  );
}
