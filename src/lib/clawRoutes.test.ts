import { describe, expect, it } from "vitest";
import {
  buildClawDetailHref,
  clawSecurityStatusMessage,
  isClawReadyToAdd,
  packageNameFromPublisherClawRoute,
} from "./clawRoutes";

describe("Claw detail routes", () => {
  it("builds a publisher Claw URL from scoped and unscoped package names", () => {
    expect(buildClawDetailHref("@maker/release-brief", "maker")).toBe("/maker/claws/release-brief");
    expect(buildClawDetailHref("release-brief", "maker")).toBe("/maker/claws/release-brief");
  });

  it("parses only a publisher and single package slug", () => {
    expect(packageNameFromPublisherClawRoute("maker", "release-brief")).toBe(
      "@maker/release-brief",
    );
    expect(packageNameFromPublisherClawRoute("@maker", "release-brief")).toBe(
      "@maker/release-brief",
    );
    expect(packageNameFromPublisherClawRoute("bad/owner", "release-brief")).toBeNull();
    expect(packageNameFromPublisherClawRoute("maker", "nested/name")).toBeNull();
  });

  it("shows adverse scan results explicitly and only offers Add for clean Claws", () => {
    expect(clawSecurityStatusMessage("clean")).toBe("Security checks passed");
    expect(clawSecurityStatusMessage("suspicious")).toContain("Wait for review");
    expect(clawSecurityStatusMessage("malicious")).toContain("Do not add it");
    expect(clawSecurityStatusMessage("pending")).toContain("not ready to add");
    expect(isClawReadyToAdd("clean")).toBe(true);
    expect(isClawReadyToAdd("suspicious")).toBe(false);
    expect(isClawReadyToAdd("malicious")).toBe(false);
    expect(isClawReadyToAdd("pending")).toBe(false);
  });
});
