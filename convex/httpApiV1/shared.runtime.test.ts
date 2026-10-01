/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { publicApiOrigin } from "./shared";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public API origin by Convex runtime", () => {
  it("preserves the canonical production origin", () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:wry-manatee-359");
    vi.stubEnv("CLAWHUB_ENV", "production");
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("VITE_SITE_URL", "");

    expect(
      publicApiOrigin(new Request("https://wry-manatee-359.convex.site/api/v1/skills/demo")),
    ).toBe("https://clawhub.ai");
  });
});
