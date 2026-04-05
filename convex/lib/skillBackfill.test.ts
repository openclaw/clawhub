import { describe, expect, it } from "vitest";
import { buildSkillSummaryBackfillPatch } from "./skillBackfill";

describe("skill backfill", () => {
  it("produces summary + parsed patch from block scalar", () => {
    const patch = buildSkillSummaryBackfillPatch({
      readmeText: `---\ndescription: >\n  Hello\n  world.\n---\nBody`,
      currentSummary: ">",
      currentParsed: { frontmatter: { description: ">" } },
    });
    expect(patch.summary).toBe("Hello world.");
    expect(patch.parsed?.frontmatter.description).toBe("Hello world.");
  });

  it("does not set summary when description is not a string", () => {
    const patch = buildSkillSummaryBackfillPatch({
      readmeText: `---\ndescription:\n  - a\n---\nBody`,
      currentSummary: "Old",
      currentParsed: { frontmatter: {} },
    });
    expect(patch.summary).toBeUndefined();
    expect(patch.parsed?.frontmatter.description).toEqual(["a"]);
  });

  it("keeps legacy summary when unchanged and still updates parsed", () => {
    const patch = buildSkillSummaryBackfillPatch({
      readmeText: `---\ndescription: Hello\n---\nBody`,
      currentSummary: "Hello",
      currentParsed: { frontmatter: { description: "nope" } },
    });
    expect(patch.summary).toBeUndefined();
    expect(patch.parsed?.frontmatter.description).toBe("Hello");
  });
});
