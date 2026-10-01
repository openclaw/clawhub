import { describe, expect, it } from "vitest";
import { resolveConvexSiteUrl } from "./convexDeploymentUrl";

describe("resolveConvexSiteUrl", () => {
  it("derives the paired HTTP Actions origin from a Convex cloud URL", () => {
    expect(
      resolveConvexSiteUrl({
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      }),
    ).toBe("https://preview-branch-123.convex.site");
  });

  it("prefers an explicit site URL for custom domains", () => {
    expect(
      resolveConvexSiteUrl({
        VITE_CONVEX_SITE_URL: "https://api.preview.example/",
        VITE_CONVEX_URL: "https://preview-branch-123.convex.cloud",
      }),
    ).toBe("https://api.preview.example");
  });

  it("rejects malformed or non-Convex cloud URLs instead of guessing", () => {
    expect(() => resolveConvexSiteUrl({ VITE_CONVEX_URL: "https://example.com" })).toThrow(
      "Cannot derive a Convex site URL",
    );
    expect(() => resolveConvexSiteUrl({ VITE_CONVEX_URL: "not-a-url" })).toThrow(
      "Cannot derive a Convex site URL",
    );
  });
});
