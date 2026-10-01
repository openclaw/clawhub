/* @vitest-environment node */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  id?: string;
  run?: string;
};

describe("secret-scan workflow", () => {
  it("uses a full-history scan for an initial push", () => {
    const workflow = parseYaml(readFileSync(".github/workflows/secret-scan.yml", "utf8")) as {
      jobs: {
        trufflehog: {
          steps: WorkflowStep[];
        };
      };
    };
    const resolveStep = workflow.jobs.trufflehog.steps.find((step) => step.id === "scan_range");
    const outputDir = mkdtempSync(join(tmpdir(), "secret-scan-workflow-"));
    const outputPath = join(outputDir, "github-output");

    try {
      execFileSync("bash", ["-c", resolveStep?.run ?? ""], {
        env: {
          ...process.env,
          DEFAULT_BRANCH: "main",
          EVENT_NAME: "push",
          GITHUB_OUTPUT: outputPath,
          PR_BASE_SHA: "",
          PR_HEAD_SHA: "",
          PUSH_BASE_SHA: "0".repeat(40),
          PUSH_HEAD_SHA: "deadbeef",
        },
      });

      expect(readFileSync(outputPath, "utf8")).toBe("base=\nhead=deadbeef\n");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
