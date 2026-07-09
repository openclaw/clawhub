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

function expectSecretStepAllowlist(
  steps: WorkflowStep[],
  secretName: string,
  allowedStepNames: string[],
) {
  for (const step of steps) {
    const stepName = step.name ?? step.uses ?? "<unnamed>";
    const hasSecret =
      Object.hasOwn(step.env ?? {}, secretName) ||
      JSON.stringify(step).includes(`secrets.${secretName}`);
    expect(hasSecret, `${secretName} on ${stepName}`).toBe(allowedStepNames.includes(stepName));
  }
}

describe("security-scan-codex workflow", () => {
  it("scans diagnostics with TruffleHog before uploading artifacts", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/security-scan-codex.yml", "utf8"),
    ) as {
      jobs: {
        "codex-security-scan": {
          env?: Record<string, unknown>;
          steps: WorkflowStep[];
          strategy?: {
            "max-parallel"?: number;
            matrix?: { include?: Array<{ lane?: string; shard?: string }> };
          };
          "timeout-minutes"?: number;
        };
      };
      on?: {
        repository_dispatch?: { types?: string[] };
        schedule?: Array<{ cron?: string }>;
        workflow_dispatch?: unknown;
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
    expect(scanStep?.run).toContain('-v "$PWD/$CODEX_SECURITY_SCAN_DIAGNOSTICS_DIR:/scan:ro"');
    expect(scanStep?.run).toContain("--only-verified");
    expect(scanStep?.run).toContain("--fail");
    expect(scanStep?.run).not.toContain("--debug");
    expect(uploadStep?.if).toBe(
      "${{ !cancelled() && steps.diagnostics_secret_scan.outcome == 'success' }}",
    );
    expect(uploadStep?.with?.path).toBe("${{ env.CODEX_SECURITY_SCAN_DIAGNOSTICS_DIR }}");
    expect(workflow.jobs["codex-security-scan"]["timeout-minutes"]).toBe(40);
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.on?.repository_dispatch?.types).toEqual(["clawhub-security-scan"]);
    expect(workflow.on?.schedule).toBeUndefined();
    expect(workflow.jobs["codex-security-scan"].strategy?.["max-parallel"]).toBe(6);
    expect(workflow.jobs["codex-security-scan"].strategy?.matrix?.include).toEqual([
      { lane: "priority", shard: "priority-0" },
      { lane: "shared", shard: "shared-0" },
      { lane: "shared", shard: "shared-1" },
      { lane: "shared", shard: "shared-2" },
      { lane: "shared", shard: "shared-3" },
      { lane: "shared", shard: "shared-4" },
    ]);
    expect(jobEnv.CODEX_SECURITY_SCAN_LANE).toBe("${{ matrix.lane }}");
    expect(jobEnv.CODEX_SECURITY_SCAN_LIMIT).toBe(
      "${{ github.event.client_payload.batch_limit || inputs.limit || inputs['batch-limit'] || '4' }}",
    );
    expect(jobEnv.CODEX_SECURITY_SCAN_MAX_JOBS).toBe(
      "${{ github.event.client_payload.max_jobs || inputs['max-jobs'] || '' }}",
    );
    expect(jobEnv.CODEX_SECURITY_SCAN_MAX_RUNTIME_MINUTES).toBe(
      "${{ github.event.client_payload.max_runtime_minutes || inputs['max-runtime-minutes'] || '12' }}",
    );
    expect(jobEnv.CODEX_SECURITY_SCAN_TIMEOUT_MS).toBe(
      "${{ vars.CODEX_SECURITY_SCAN_TIMEOUT_MS || '240000' }}",
    );
    expect(jobEnv).not.toHaveProperty("OPENAI_API_KEY");
    expect(jobEnv).not.toHaveProperty("CODEX_API_KEY");
    expect(jobEnv).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expectSecretStepAllowlist(steps, "CODEX_API_KEY", ["Run Codex security worker"]);
    expectSecretStepAllowlist(steps, "OPENAI_API_KEY", [
      "Authenticate Codex CLI",
      "Run Codex security worker",
    ]);
    expectSecretStepAllowlist(steps, "SECURITY_SCAN_WORKER_TOKEN", ["Run Codex security worker"]);
    expect(scanStep?.env ?? {}).not.toHaveProperty("CODEX_API_KEY");
    expect(scanStep?.env ?? {}).not.toHaveProperty("OPENAI_API_KEY");
    expect(scanStep?.env ?? {}).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expect(steps.find((step) => step.name === "Check configuration")).toBeUndefined();
    const codexInstall = steps.find((step) => step.name === "Install Codex CLI")?.run;
    const skillspectorInstall = steps.find((step) => step.name === "Install SkillSpector")?.run;
    expect(codexInstall).toContain("npm install -g @openai/codex@0.142.3");
    expect(codexInstall).not.toContain("@latest");
    expect(skillspectorInstall).toContain("git+https://github.com/NVIDIA/skillspector.git@8f37cfa");
    expect(skillspectorInstall).not.toContain("git+https://github.com/NVIDIA/skillspector.git'");
    expect(steps.find((step) => step.name === "Run Codex security worker")?.env).toEqual({
      CODEX_API_KEY: "${{ secrets.CODEX_API_KEY || secrets.OPENAI_API_KEY }}",
      OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}",
      SECURITY_SCAN_WORKER_TOKEN: "${{ secrets.SECURITY_SCAN_WORKER_TOKEN }}",
    });
  });
});
