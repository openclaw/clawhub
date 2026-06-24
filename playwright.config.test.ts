import { expect, test } from "vitest";
import config from "./playwright.config";

test("Playwright waits for a static preview asset before running browser smoke tests", () => {
  expect(config.webServer).toBeTruthy();
  const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;

  expect(webServer?.command).toBe("HOST=127.0.0.1 PORT=4173 bun .output/server/index.mjs");
  expect(webServer?.url).toBe("http://127.0.0.1:4173/favicon.ico");
  expect(webServer?.timeout).toBe(300_000);
});
