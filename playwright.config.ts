import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: [
    ...(process.env.AUTH_E2E_MOCK === "true"
      ? [
          {
            command: "node scripts/mock-auth.mjs",
            url: "http://127.0.0.1:54321/health",
            reuseExistingServer: false,
          },
        ]
      : []),
    {
      command: "npm run start -- --port 3100",
      url: "http://127.0.0.1:3100/login",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
