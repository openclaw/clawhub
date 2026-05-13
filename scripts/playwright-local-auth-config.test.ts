import { describe, expect, it } from "vitest";
import { resolveLocalAuthRunnerConfig } from "./playwright-local-auth-config";

describe("playwright local-auth runner config", () => {
  it("does not inherit the generic CI Convex URL", () => {
    expect(
      resolveLocalAuthRunnerConfig({
        VITE_CONVEX_URL: "https://example.invalid",
        VITE_CONVEX_SITE_URL: "https://example.invalid",
      }),
    ).toMatchObject({
      convexSiteUrl: "http://127.0.0.1:3211",
      convexUrl: "http://127.0.0.1:3210",
    });
  });

  it("uses local-auth-specific Convex URL overrides", () => {
    expect(
      resolveLocalAuthRunnerConfig({
        PLAYWRIGHT_LOCAL_AUTH_CONVEX_SITE_URL: "http://127.0.0.1:4311",
        PLAYWRIGHT_LOCAL_AUTH_CONVEX_URL: "http://127.0.0.1:4310",
      }),
    ).toMatchObject({
      convexSiteUrl: "http://127.0.0.1:4311",
      convexUrl: "http://127.0.0.1:4310",
    });
  });

  it("passes explicit Playwright args and defaults to the local-auth suite", () => {
    expect(resolveLocalAuthRunnerConfig({}, ["--", "e2e/example.pw.test.ts"])).toMatchObject({
      playwrightArgs: ["e2e/example.pw.test.ts"],
    });
    expect(resolveLocalAuthRunnerConfig({}).playwrightArgs).toEqual([
      "--project=chromium",
      "e2e/local-auth",
    ]);
  });
});
