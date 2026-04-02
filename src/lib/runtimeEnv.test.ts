/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequiredRuntimeEnv, getRuntimeEnv, isDevRuntime } from "./runtimeEnv";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtimeEnv", () => {
  it("reads from process env on the server", () => {
    vi.stubEnv("VITE_SITE_URL", "https://clawhub.ai");
    expect(getRuntimeEnv("VITE_SITE_URL")).toBe("https://clawhub.ai");
  });

  it("throws for missing required env", () => {
    expect(() => getRequiredRuntimeEnv("VITE_MISSING_VALUE")).toThrow(
      "Missing required environment variable: VITE_MISSING_VALUE",
    );
  });

  it("uses NODE_ENV to detect server dev mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevRuntime()).toBe(false);

    vi.stubEnv("NODE_ENV", "development");
    expect(isDevRuntime()).toBe(true);
  });
});
