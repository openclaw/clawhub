import { describe, expect, it } from "vitest";
import { skillCardLoadKey } from "./skillCards";

describe("skillCardLoadKey", () => {
  it("changes when the generated card file hash changes within a version", () => {
    const first = skillCardLoadKey("skillVersions:1", {
      path: "skill-card.md",
      sha256: "a".repeat(64),
    });
    const second = skillCardLoadKey("skillVersions:1", {
      path: "skill-card.md",
      sha256: "b".repeat(64),
    });

    expect(first).not.toBe(second);
  });
});
