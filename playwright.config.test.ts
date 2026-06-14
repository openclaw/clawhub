import { expect, test } from "vitest";
import config from "./playwright.config";

test("Playwright waits for a static preview asset before running browser smoke tests", () => {
  expect(config.webServer).toBeTruthy();
  const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;

  expect(webServer?.url).toBe("http://127.0.0.1:4173/favicon.ico");
});
