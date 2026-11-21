import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PLAYWRIGHT_PORT", undefined);
  vi.stubEnv("PLAYWRIGHT_BASE_URL", undefined);
  vi.stubEnv("PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS", undefined);
});

afterEach(() => vi.unstubAllEnvs());

test("Playwright waits for a static preview asset before running browser smoke tests", async () => {
  const { default: config } = await import("./playwright.config");
  expect(config.webServer).toBeTruthy();
  const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;

  expect(webServer?.command).toBe("HOST=127.0.0.1 PORT=4173 bun .output/server/index.mjs");
  expect(webServer?.url).toBe("http://127.0.0.1:4173/favicon.ico");
  expect(webServer?.timeout).toBe(300_000);
});

test("Playwright starts and probes the preview on the configured port", async () => {
  vi.stubEnv("PLAYWRIGHT_PORT", "43210");
  const { default: config } = await import("./playwright.config");
  const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;

  expect(config.use?.baseURL).toBe("http://127.0.0.1:43210");
  expect(webServer?.command).toBe("HOST=127.0.0.1 PORT=43210 bun .output/server/index.mjs");
  expect(webServer?.url).toBe("http://127.0.0.1:43210/favicon.ico");
});

test("Playwright uses an external URL without starting a preview", async () => {
  vi.stubEnv("PLAYWRIGHT_PORT", "43210");
  vi.stubEnv("PLAYWRIGHT_BASE_URL", "https://example.invalid/preview");
  const { default: config } = await import("./playwright.config");

  expect(config.use?.baseURL).toBe("https://example.invalid/preview");
  expect(config.webServer).toBeUndefined();
});
