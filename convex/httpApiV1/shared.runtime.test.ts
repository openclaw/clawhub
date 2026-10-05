/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { publicApiOrigin } from "./shared";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public API origin by Convex runtime", () => {
  it("does not give the staging deployment the production site origin", () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:cheery-civet-733");
    vi.stubEnv("CLAWHUB_ENV", "staging");
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("VITE_SITE_URL", "");
    const request = new Request("https://cheery-civet-733.convex.site/api/v1/skills/demo");

    expect(publicApiOrigin(request)).toBe("https://cheery-civet-733.convex.site");

    vi.stubEnv("SITE_URL", "https://stg.clawhub.ai");
    expect(publicApiOrigin(request)).toBe("https://stg.clawhub.ai");
  });

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
