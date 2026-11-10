import { defineConfig, devices } from "@playwright/test";

const PREVIEW_URL = "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  use: {
    baseURL: PREVIEW_URL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --strictPort",
    url: PREVIEW_URL,
  },
});
