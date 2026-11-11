import { describe, expect, it } from "vitest";
import {
  buildTemplateDetailHref,
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

  it("only offers Add for clean Templates", () => {
    expect(isTemplateReadyToAdd("clean")).toBe(true);
    expect(isTemplateReadyToAdd("suspicious")).toBe(false);
    expect(isTemplateReadyToAdd("malicious")).toBe(false);
    expect(isTemplateReadyToAdd("pending")).toBe(false);
    expect(isTemplateReadyToAdd("not-run")).toBe(false);
    expect(isTemplateReadyToAdd(null)).toBe(false);
    expect(isTemplateReadyToAdd(undefined)).toBe(false);
  });
});
