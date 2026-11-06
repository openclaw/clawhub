/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { contentDispositionAttachment, publicApiOrigin } from "./shared";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("archive attachment filenames", () => {
  it.each([
    [
      "plugin-1\r\nX-Injected: yes.zip",
      "plugin-1_X-Injected_yes.zip",
      "plugin-1%0D%0AX-Injected%3A%20yes.zip",
    ],
    ["plugin-café.tgz", "plugin-caf.tgz", "plugin-caf%C3%A9.tgz"],
    ["!!!.zip", "download.zip", "!!!.zip"],
  ])("serializes %j as one valid attachment header", (filename, fallback, encoded) => {
    const response = new Response("archive", {
      headers: { "Content-Disposition": contentDispositionAttachment(filename) },
    });
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    );
    expect(response.headers.has("X-Injected")).toBe(false);
  });
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
