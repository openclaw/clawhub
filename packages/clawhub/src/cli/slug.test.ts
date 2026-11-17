import { describe, expect, it } from "vitest";
import { displayNameFromPath } from "./slug.js";

describe("displayNameFromPath", () => {
  it.each([
    ["cooking-companion-0.2.0.tgz", "Cooking Companion"],
    ["demo-claw-1.0.0.tar.gz", "Demo Claw"],
    ["demo-claw-v1.2.3.tgz", "Demo Claw"],
    ["demo-claw-1.0.0-beta.1.tgz", "Demo Claw"],
    ["demo-claw.tgz", "Demo Claw"],
    ["demo_plugin", "Demo Plugin"],
    ["demo-plugin-2.0.0", "Demo Plugin"],
  ])("derives %s as %s", (input, expected) => {
    expect(displayNameFromPath(input)).toBe(expected);
  });

  it("keeps a bare version when it is the whole name", () => {
    expect(displayNameFromPath("1.0.0.tgz")).toBe("1.0.0");
  });
});
