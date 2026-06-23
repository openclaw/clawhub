/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, unknown>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

describe("security-scan-codex workflow", () => {
  it("scans diagnostics with TruffleHog before uploading artifacts", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/security-scan-codex.yml", "utf8"),
    ) as {
      jobs: {
        "codex-security-scan": {
          env?: Record<string, unknown>;
          steps: WorkflowStep[];
        };
      };
    };
    const steps = workflow.jobs["codex-security-scan"].steps;
    const jobEnv = workflow.jobs["codex-security-scan"].env ?? {};
    const scanIndex = steps.findIndex((step) => step.id === "diagnostics_secret_scan");
    const uploadIndex = steps.findIndex((step) => step.uses === "actions/upload-artifact@v7");
    const scanStep = steps[scanIndex];
    const uploadStep = steps[uploadIndex];

    expect(scanIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(scanIndex).toBeLessThan(uploadIndex);
    expect(scanStep?.run).toContain(
      "ghcr.io/trufflesecurity/trufflehog:3.95.5@sha256:56c25710275c4b8d74c4f1346a5e7c606fa7ff4afe996f680b288d0fae3fcd9c",
    );
    expect(scanStep?.run).toContain("filesystem /scan");
    expect(scanStep?.run).toContain("--only-verified");
    expect(scanStep?.run).toContain("--fail");
    expect(scanStep?.run).not.toContain("--debug");
    expect(uploadStep?.if).toBe(
      "${{ !cancelled() && steps.diagnostics_secret_scan.outcome == 'success' }}",
    );
    expect(jobEnv).not.toHaveProperty("OPENAI_API_KEY");
    expect(jobEnv).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expect(scanStep?.env ?? {}).not.toHaveProperty("OPENAI_API_KEY");
    expect(scanStep?.env ?? {}).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expect(steps.find((step) => step.name === "Check configuration")).toBeUndefined();
    expect(steps.find((step) => step.name === "Run Codex security worker")?.env).toEqual({
      OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}",
      SECURITY_SCAN_WORKER_TOKEN: "${{ secrets.SECURITY_SCAN_WORKER_TOKEN }}",
    });
  });
});
