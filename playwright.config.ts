import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const previewReadyURL = new URL("/favicon.ico", baseURL).toString();
const workerCount = Number(process.env.PLAYWRIGHT_WORKERS ?? 2);
const webServerTimeout = Number(process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS ?? 300_000);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.pw\.test\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: Number.isFinite(workerCount) && workerCount > 0 ? workerCount : 2,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "HOST=127.0.0.1 PORT=4173 bun .output/server/index.mjs",
        url: previewReadyURL,
        reuseExistingServer: !process.env.CI,
        stdout: "ignore",
        stderr: "pipe",
        timeout:
          Number.isFinite(webServerTimeout) && webServerTimeout > 0 ? webServerTimeout : 300_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
