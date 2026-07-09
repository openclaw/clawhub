/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequiredRuntimeEnv, getRuntimeEnv, isDevRuntime } from "./runtimeEnv";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("runtimeEnv", () => {
  it("reads from process env on the server", () => {
    vi.stubEnv("VITE_SITE_URL", "https://clawhub.ai");
    expect(getRuntimeEnv("VITE_SITE_URL")).toBe("https://clawhub.ai");
  });

  it("prefers import.meta.env in the browser", () => {
    const originalClientValue = import.meta.env.VITE_SITE_URL;
    vi.stubEnv("VITE_SITE_URL", "https://process.example");
    import.meta.env.VITE_SITE_URL = "https://client.example";
    vi.stubGlobal("window", {});

    expect(getRuntimeEnv("VITE_SITE_URL")).toBe("https://client.example");

    import.meta.env.VITE_SITE_URL = originalClientValue;
  });

  it("prefers the bundled Convex URL for preview SSR", () => {
    const originalDeployEnv = import.meta.env.VITE_CLAWHUB_DEPLOY_ENV;
    const originalConvexUrl = import.meta.env.VITE_CONVEX_URL;
    vi.stubEnv("VITE_CLAWHUB_DEPLOY_ENV", "production");
    vi.stubEnv("VITE_CONVEX_URL", "https://wry-manatee-359.convex.cloud");
    import.meta.env.VITE_CLAWHUB_DEPLOY_ENV = "preview";
    import.meta.env.VITE_CONVEX_URL = "https://paired-preview-123.convex.cloud";

    expect(getRuntimeEnv("VITE_CONVEX_URL")).toBe("https://paired-preview-123.convex.cloud");

    import.meta.env.VITE_CLAWHUB_DEPLOY_ENV = originalDeployEnv;
    import.meta.env.VITE_CONVEX_URL = originalConvexUrl;
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
