/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { absolutePackageArtifactUrl } from "./packageInspectorHttp";

describe("package inspector HTTP helpers", () => {
  it("returns the protected artifact route for scan claims", () => {
    const request = new Request("https://example.com/api/v1/package-inspector/claim");

    expect(absolutePackageArtifactUrl(request, "packageReleases:demo-1")).toBe(
      "https://example.com/api/v1/package-inspector/artifact?releaseId=packageReleases%3Ademo-1",
    );
  });
});
