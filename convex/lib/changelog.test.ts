import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __test, generatePackageChangelogPreview } from "./changelog";

describe("changelog utils", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
  });
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

  it("builds package changelog previews from the previous package release", async () => {
    const ctx = {
      runQuery: vi.fn(async () => ({
        latestRelease: {
          _id: "packageReleases:demo-1",
          files: [
            { path: "readme.md", sha256: "old-readme", storageId: "storage:readme" },
            { path: "src/index.ts", sha256: "old-index", storageId: "storage:index" },
          ],
        },
      })),
      storage: {
        get: vi.fn(async (storageId: string) =>
          storageId === "storage:readme" ? new Blob(["# Old package readme"]) : null,
        ),
      },
    };

    const text = await generatePackageChangelogPreview(ctx as never, {
      name: "demo-plugin",
      version: "1.1.0",
      readmeText: "# New package readme",
      filePaths: ["readme.md", "src/index.ts", "src/extra.ts"],
      viewerUserId: "users:owner" as never,
    });

    expect(ctx.runQuery).toHaveBeenCalledWith(expect.anything(), {
      name: "demo-plugin",
      viewerUserId: "users:owner",
    });
    expect(text).toContain("added 1 file");
    expect(text).toContain("Updated README and package contents.");
  });

  it("falls back to a package-specific message when package preview lookup fails", async () => {
    const text = await generatePackageChangelogPreview(
      {
        runQuery: vi.fn(async () => {
          throw new Error("boom");
        }),
        storage: { get: vi.fn() },
      } as never,
      {
        name: "demo-plugin",
        version: "1.0.0",
        readmeText: "# Demo",
        viewerUserId: "users:owner" as never,
      },
    );

    expect(text).toBe("- Updated package.");
  });
});
