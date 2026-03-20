import { describe, expect, it } from "vitest";
import { __test } from "./changelog";

describe("changelog utils", () => {
  it("summarizes file diffs", () => {
    const diff = __test.summarizeFileDiff(
      [
        { path: "a.txt", sha256: "aaa" },
        { path: "b.txt", sha256: "bbb" },
      ],
      [
        { path: "a.txt", sha256: "aaa" },
        { path: "b.txt", sha256: "ccc" },
        { path: "c.txt", sha256: "ddd" },
      ],
    );

    expect(diff.added).toEqual(["c.txt"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual(["b.txt"]);
    expect(__test.formatDiffSummary(diff)).toBe("1 added, 1 changed");
  });

  it("generates a fallback initial release note", () => {
    const text = __test.generateFallback({
      slug: "demo",
      version: "1.0.0",
      oldReadme: null,
      nextReadme: "hi",
      fileDiff: null,
    });
    expect(text).toMatch(/Initial release/i);
  });
});
