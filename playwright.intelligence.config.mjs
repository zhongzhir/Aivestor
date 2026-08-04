import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./artifacts/playwright-intelligence",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "./artifacts/playwright-intelligence/results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`,
    trace: "on",
    screenshot: "on",
    video: "off",
    ...devices["Desktop Chrome"],
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run start -- -p ${port}`,
        url: `http://127.0.0.1:${port}/api/health`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
