import { describe, expect, it } from "vitest";
import { displayNameFromArchive } from "./slug.js";

describe("displayNameFromArchive", () => {
  it.each([
    ["cooking-companion-0.2.0.tgz", "0.2.0", "Cooking Companion"],
    ["demo-claw-1.0.0.tar.gz", "1.0.0", "Demo Claw"],
    ["demo-claw-v1.2.3.tgz", "1.2.3", "Demo Claw"],
    ["demo-claw-1.0.0-beta.1.tgz", "1.0.0-beta.1", "Demo Claw"],
    ["demo-claw-1.0.0+build.1.tgz", "1.0.0+build.1", "Demo Claw"],
    ["demo-claw_1.0.0.tgz", "1.0.0", "Demo Claw"],
    ["demo-claw@v1.0.0.tgz", "1.0.0", "Demo Claw"],
    ["demo-claw.tgz", "1.0.0", "Demo Claw"],
    ["http-1.0.0-helper-2.0.0.tgz", "2.0.0", "Http 1.0.0 Helper"],
    ["http-1.0.0-helper-2.0.0-beta.1.tgz", "2.0.0-beta.1", "Http 1.0.0 Helper"],
    ["demo-claw-2.0.0.tgz", "1.0.0", "Demo Claw 2.0.0"],
    ["demo-claw-11.0.0.tgz", "1.0.0", "Demo Claw 11.0.0"],
    ["1.0.0.tgz", "1.0.0", "1.0.0"],
  ])("derives %s at version %s as %s", (input, version, expected) => {
    expect(displayNameFromArchive(input, version)).toBe(expected);
  });
});
