/* @vitest-environment node */
import { chmod, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { bundledSkillSpectorTerminalContext } from "./bundled-skillspector-diagnostic";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["missing", "invalid", "symlink", "world-readable", "oversized"])(
  "fails closed on %s terminal evidence without echoing labels or raw errors",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "bundled-terminal-"));
    roots.push(root);
    const file = join(root, "report.json");
    const canary = "private-source-and-credential-canary";
    if (mode !== "missing") {
      await writeFile(file, mode === "invalid" ? canary : JSON.stringify({ summary: canary }), {
        mode: 0o600,
      });
      if (mode === "symlink") {
        const destination = join(root, "private.json");
        await writeFile(destination, JSON.stringify({ summary: canary }), { mode: 0o600 });
        await rm(file);
        await symlink(destination, file);
      } else if (mode === "world-readable") await chmod(file, 0o644);
      else if (mode === "oversized") await truncate(file, 32 * 1024 * 1024 + 1);
    }
    const result = await bundledSkillSpectorTerminalContext(file);
    expect(result.presence).toBe(mode === "missing" ? "missing" : "invalid");
    expect(result.executionSuccessful).toBeNull();
    expect(result.completenessStatus).toBe("unknown");
    expect(result.incompleteAnalyzers).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result).not.toHaveProperty("sha256");
    expect(result).not.toHaveProperty("limits");
  },
);

it("retains known failure categories while counting malformed and unknown metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "bundled-terminal-"));
  roots.push(root);
  const file = join(root, "report.json");
  const canary = "private-arbitrary-analyzer-and-reason";
  await writeFile(
    file,
    JSON.stringify({
      execution_successful: canary,
      summary: canary,
      analysis_completeness: {
        status: canary,
        ledger_exceptions: [
          { reason_code: canary },
          { reason_code: "analyzer_runtime_error", detail: canary },
        ],
        analyzer_statuses: [
          {
            analyzer_id: "meta_analyzer",
            status: "failed",
            planned_work: 10_000_001,
            completed: canary,
            partial: -1,
            skipped: 1.5,
            failed: 1,
            unaccounted: 0,
          },
          { analyzer_id: canary, status: canary },
        ],
      },
    }),
    { mode: 0o600 },
  );
  const result = await bundledSkillSpectorTerminalContext(file);
  expect(result).toEqual({
    presence: "present",
    executionSuccessful: null,
    completenessStatus: "unknown",
    reasonCounts: { analyzer_runtime_error: 1 },
    unknownReasons: 1,
    unknownAnalyzers: 1,
    incompleteAnalyzers: [
      {
        id: "meta_analyzer",
        status: "failed",
        planned_work: null,
        completed: null,
        partial: null,
        skipped: null,
        failed: 1,
        unaccounted: 0,
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain(canary);
});
