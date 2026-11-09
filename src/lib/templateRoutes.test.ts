import { describe, expect, it } from "vitest";
import {
  buildTemplateDetailHref,
  templateSecurityStatusMessage,
  isTemplateReadyToAdd,
  packageNameFromPublisherTemplateRoute,
} from "./templateRoutes";

describe("Template detail routes", () => {
  it("builds a publisher Template URL from scoped and unscoped package names", () => {
    expect(buildTemplateDetailHref("@maker/release-brief", "maker")).toBe(
      "/maker/templates/release-brief",
    );
    expect(buildTemplateDetailHref("release-brief", "maker")).toBe(
      "/maker/templates/release-brief",
    );
  });

  it("parses only a publisher and single package slug", () => {
    expect(packageNameFromPublisherTemplateRoute("maker", "release-brief")).toBe(
      "@maker/release-brief",
    );
    expect(packageNameFromPublisherTemplateRoute("@maker", "release-brief")).toBe(
      "@maker/release-brief",
    );
    expect(packageNameFromPublisherTemplateRoute("bad/owner", "release-brief")).toBeNull();
    expect(packageNameFromPublisherTemplateRoute("maker", "nested/name")).toBeNull();
  });

  it("shows adverse scan results explicitly and only offers Add for clean Templates", () => {
    expect(templateSecurityStatusMessage("clean")).toBe("Security checks passed");
    expect(templateSecurityStatusMessage("suspicious")).toContain("Wait for review");
    expect(templateSecurityStatusMessage("malicious")).toContain("Do not add it");
    expect(templateSecurityStatusMessage("pending")).toContain("not ready to add");
    expect(isTemplateReadyToAdd("clean")).toBe(true);
    expect(isTemplateReadyToAdd("suspicious")).toBe(false);
    expect(isTemplateReadyToAdd("malicious")).toBe(false);
    expect(isTemplateReadyToAdd("pending")).toBe(false);
  });
});
