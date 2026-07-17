/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, unknown>;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

function stepUsesSecret(step: WorkflowStep, secretName: string) {
  return (
    Object.hasOwn(step.env ?? {}, secretName) ||
    JSON.stringify(step).includes(`secrets.${secretName}`)
  );
}

describe("pre-publication publish worker workflow", () => {
  it("runs the missing staged-publish worker on a schedule with scoped secrets", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/prepublication-publish-checks.yml", "utf8"),
    ) as {
      jobs: {
        "prepublication-publish-checks": {
          concurrency?: unknown;
          env?: Record<string, unknown>;
          environment?: string;
          "runs-on"?: string;
          steps: WorkflowStep[];
          strategy?: { matrix?: { shard?: number[] }; "max-parallel"?: number };
          "timeout-minutes"?: number;
        };
      };
      on?: {
        schedule?: Array<{ cron?: string }>;
        workflow_dispatch?: {
          inputs?: {
            "attempt-id"?: {
              default?: string;
              required?: boolean;
            };
            kind?: {
              default?: string;
              required?: boolean;
            };
            runner?: {
              default?: string;
              options?: string[];
              type?: string;
            };
            slug?: {
              default?: string;
              required?: boolean;
            };
            version?: {
              default?: string;
              required?: boolean;
            };
          };
        };
      };
    };

    const job = workflow.jobs["prepublication-publish-checks"];
    const steps = job.steps;
    expect(workflow.on?.schedule?.[0]?.cron).toBe("*/5 * * * *");
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.on?.workflow_dispatch?.inputs?.runner).toEqual({
      description: "Runner label for manual recovery dispatches",
      required: true,
      default: "blacksmith-8vcpu-ubuntu-2404",
      type: "choice",
      options: ["blacksmith-8vcpu-ubuntu-2404", "ubuntu-latest"],
    });
    expect(workflow.on?.workflow_dispatch?.inputs?.kind).toMatchObject({
      required: false,
      default: "",
    });
    expect(workflow.on?.workflow_dispatch?.inputs?.["attempt-id"]).toMatchObject({
      required: false,
      default: "",
    });
    expect(workflow.on?.workflow_dispatch?.inputs?.slug).toMatchObject({
      required: false,
      default: "",
    });
    expect(workflow.on?.workflow_dispatch?.inputs?.version).toMatchObject({
      required: false,
      default: "",
    });
    expect(job.environment).toBe("Production");
    expect(job["runs-on"]).toBe("${{ inputs.runner || 'blacksmith-8vcpu-ubuntu-2404' }}");
    expect(job["timeout-minutes"]).toBe(20);
    expect(job.strategy?.matrix?.shard).toEqual([0, 1]);
    expect(job.strategy?.["max-parallel"]).toBe(2);
    expect(job.env).toMatchObject({
      CONVEX_URL:
        "${{ vars.CONVEX_URL || vars.VITE_CONVEX_URL || 'https://wry-manatee-359.convex.cloud' }}",
      PREPUBLICATION_CLAWSCAN_TIMEOUT_MS:
        "${{ vars.PREPUBLICATION_CLAWSCAN_TIMEOUT_MS || '240000' }}",
      PREPUBLICATION_CHECK_ATTEMPT_ID: "${{ inputs['attempt-id'] || '' }}",
      PREPUBLICATION_CHECK_LIMIT: "${{ inputs['batch-limit'] || '2' }}",
      PREPUBLICATION_CHECK_KIND: "${{ inputs.kind || '' }}",
      PREPUBLICATION_CHECK_SLUG: "${{ inputs.slug || '' }}",
      PREPUBLICATION_CHECK_VERSION: "${{ inputs.version || '' }}",
      PREPUBLICATION_TRUFFLEHOG_IMAGE:
        "${{ vars.PREPUBLICATION_TRUFFLEHOG_IMAGE || 'ghcr.io/trufflesecurity/trufflehog:3.95.6@sha256:96f8429082cb2d4ae73b1096dcdb2f5aa139881d97042b0c5e5fa226a392e056' }}",
    });
    expect(String(job.env?.PREPUBLICATION_TRUFFLEHOG_IMAGE)).toContain("@sha256:");
    expect(job.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(job.env).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expect(job.env).not.toHaveProperty("CODEX_SECURITY_SCAN_TIMEOUT_MS");

    const runStep = steps.find((step) => step.name === "Run pre-publication publish worker");
    expect(runStep?.run).toContain("bun run publish:prepublication-worker");
    expect(runStep?.run).toContain('--attempt-id "$PREPUBLICATION_CHECK_ATTEMPT_ID"');
    expect(runStep?.run).toContain('--kind "$PREPUBLICATION_CHECK_KIND"');
    expect(runStep?.run).toContain('--slug "$PREPUBLICATION_CHECK_SLUG"');
    expect(runStep?.run).toContain('--version "$PREPUBLICATION_CHECK_VERSION"');
    expect(steps.find((step) => step.name === "Install ClawScan CLI")?.run).toContain(
      "npm install -g @openclaw/clawscan@0.1.4",
    );
    expect(steps.find((step) => step.name === "Install Codex CLI")).toBeUndefined();
    expect(steps.find((step) => step.name === "Authenticate Codex CLI")).toBeUndefined();
    expect(steps.find((step) => step.name === "Install SkillSpector")).toBeUndefined();
    expect(JSON.stringify(job)).not.toContain("CODEX_SECURITY_SCAN_SHADOW_CLAWSCAN");
    expect(runStep?.env).toEqual({
      OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}",
      SECURITY_SCAN_WORKER_TOKEN: "${{ secrets.SECURITY_SCAN_WORKER_TOKEN }}",
      VIRUSTOTAL_API_KEY: "${{ secrets.VT_API_KEY }}",
    });

    for (const step of steps) {
      const stepName = step.name ?? step.uses ?? "<unnamed>";
      expect(stepUsesSecret(step, "SECURITY_SCAN_WORKER_TOKEN"), stepName).toBe(
        stepName === "Run pre-publication publish worker",
      );
      expect(stepUsesSecret(step, "OPENAI_API_KEY"), stepName).toBe(
        stepName === "Run pre-publication publish worker",
      );
      expect(stepUsesSecret(step, "VT_API_KEY"), stepName).toBe(
        stepName === "Run pre-publication publish worker",
      );
    }
  });
});
