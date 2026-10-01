import { describe, expect, it } from "vitest";
import {
  extractSkillFrontmatterDescription,
  truncateSkillPublishSummary,
} from "./skillFrontmatter";

describe("extractSkillFrontmatterDescription", () => {
  it("reads a top-level description field", () => {
    const content = `---
name: demo
description: Automate recurring workflows.
---
# Demo`;

    expect(extractSkillFrontmatterDescription(content)).toBe("Automate recurring workflows.");
  });

  it("prefers metadata.description when present", () => {
    const content = `---
name: demo
description: Legacy description.
metadata:
  description: Use this skill when the user needs CSV analysis.
---
# Demo`;

    expect(extractSkillFrontmatterDescription(content)).toBe(
      "Use this skill when the user needs CSV analysis.",
    );
  });

  it("returns undefined when no description is present", () => {
    expect(extractSkillFrontmatterDescription("# Demo")).toBeUndefined();
    expect(extractSkillFrontmatterDescription("---\nname: demo\n---\n# Demo")).toBeUndefined();
  });
});

describe("truncateSkillPublishSummary", () => {
  it("keeps short values unchanged", () => {
    expect(truncateSkillPublishSummary("Short summary", 300)).toBe("Short summary");
  });

  it("truncates long values to the publish summary limit", () => {
    const longDescription = "a".repeat(350);
    expect(truncateSkillPublishSummary(longDescription, 300)).toHaveLength(300);
  });
});
