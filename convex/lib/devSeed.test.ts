import { describe, expect, it } from "vitest";
import { assertPreviewSeedAllowed } from "./devSeed";

describe("assertPreviewSeedAllowed", () => {
  it("allows an explicitly marked disposable preview deployment", () => {
    expect(() =>
      assertPreviewSeedAllowed("ClawHub PR preview", {
        CLAWHUB_PREVIEW: "1",
        CONVEX_CLOUD_URL: "https://preview-branch-123.convex.cloud",
      }),
    ).not.toThrow();
  });

  it("rejects missing preview markers and the production deployment", () => {
    expect(() =>
      assertPreviewSeedAllowed("ClawHub PR preview", {
        CONVEX_CLOUD_URL: "https://preview-branch-123.convex.cloud",
      }),
    ).toThrow("requires CLAWHUB_PREVIEW=1");

    expect(() =>
      assertPreviewSeedAllowed("ClawHub PR preview", {
        CLAWHUB_PREVIEW: "1",
        CONVEX_CLOUD_URL: "https://wry-manatee-359.convex.cloud",
      }),
    ).toThrow("is disabled for the production deployment");
  });
});
