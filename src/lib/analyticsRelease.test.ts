import { describe, expect, it } from "vitest";
import { analyticsReleaseFromModuleUrl } from "./analyticsRelease";

describe("analytics executing-client release identity", () => {
  it("retains only a bounded hashed module basename, never its origin/query/fragment", () => {
    expect(
      analyticsReleaseFromModuleUrl(
        "https://clawhub.ai/assets/__root-Abc_123-.js?private=secret#secret",
      ),
    ).toBe("__root-Abc_123-.js");
    expect(analyticsReleaseFromModuleUrl("http://localhost:3000/assets/app-12345678.js")).toBe(
      "app-12345678.js",
    );
    expect(analyticsReleaseFromModuleUrl(`https://clawhub.ai/${"x".repeat(80)}-12345678.js`)).toBe(
      `${"x".repeat(80)}-12345678.js`,
    );
  });
  it.each([
    "",
    "not a URL",
    "https://clawhub.ai/",
    "file:///assets/app-12345678.js",
    "data:text/javascript,anything",
    "https://clawhub.ai/src/GoogleAnalytics.tsx",
    "https://clawhub.ai/assets/app.js",
    "https://clawhub.ai/assets/app-short.js",
    `https://clawhub.ai/${"x".repeat(81)}-12345678.js`,
  ])("fails closed for development, server or malformed module URLs: %s", (url) => {
    expect(analyticsReleaseFromModuleUrl(url)).toBe("unknown");
  });
});
