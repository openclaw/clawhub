/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const PRODUCTION_WORKER_SCRIPTS = [
  "scripts/security/run-codex-scan-worker.ts",
  "scripts/skill-cards/run-skill-card-worker.ts",
];

describe("production worker console guard", () => {
  it("keeps raw console logging out of production worker scripts", async () => {
    const violations: string[] = [];
    for (const path of PRODUCTION_WORKER_SCRIPTS) {
      const text = await readFile(path, "utf8");
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (/\bconsole\.(?:log|warn|error)\s*\(/.test(line)) {
          violations.push(`${path}:${index + 1}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
