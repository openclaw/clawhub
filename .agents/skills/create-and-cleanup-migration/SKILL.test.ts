import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skillPath = join(import.meta.dirname, "SKILL.md");

describe("create-and-cleanup-migration skill", () => {
  it("requires a manual Convex dashboard backup before production apply", async () => {
    const markdown = await readFile(skillPath, "utf8");

    expect(markdown).toContain("https://dashboard.convex.dev/");
    expect(markdown).toContain("Backup Now");
    expect(markdown).toContain("wait for completion");
    expect(markdown).toContain("explicitly confirm in the thread");
    expect(markdown).toMatch(/before any production migration apply/i);
    expect(markdown).toMatch(/Do not automate/i);
  });
});
