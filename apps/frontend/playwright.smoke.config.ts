import { defineConfig, devices } from "@playwright/test";

declare const process: { env: Record<string, string | undefined> };

function requiredUrl(): string {
  const url = process.env.SMOKE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "Set SMOKE_URL to the running dashboard, like http://localhost:4080.",
    );
  }

  return url;
}

export default defineConfig({
  testDir: "smoke",
  use: {
    baseURL: requiredUrl(),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
