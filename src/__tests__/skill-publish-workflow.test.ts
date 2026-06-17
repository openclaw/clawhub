import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("skill publish workflow", () => {
  it("publishes one skill at a time without recreating the sync command", () => {
    const workflow = readFileSync(resolve(".github/workflows/skill-publish.yml"), "utf8");

    expect(() => parseYaml(workflow)).not.toThrow();
    expect(workflow).toContain("skill publish");
    expect(workflow).toContain("INPUT_SKILL_PATH");
    expect(workflow).toContain("INPUT_ROOT");
    expect(workflow).toContain("--dry-run");
    expect(workflow).toContain("--json");
    expect(workflow).toContain("--source-repo");
    expect(workflow).toContain("--source-commit");
    expect(workflow).toContain("alreadySynced");
    expect(workflow).toContain("wouldPublish");
    expect(workflow).not.toMatch(/\bsync\b/);
    expect(workflow).not.toContain("--bump");
  });
});
