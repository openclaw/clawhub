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
        "dispatch-test": {
          steps: WorkflowStep[];
          permissions?: Record<string, string>;
        };
        "reject-test-target-on-staging-ref": {
          if?: string;
          steps: WorkflowStep[];
        };
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
        repository_dispatch?: {
          types?: string[];
        };
        schedule?: Array<{ cron?: string }>;
        workflow_dispatch?: {
          inputs?: {
            "batch-limit"?: {
              default?: string;
              required?: boolean;
            };
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
            "target-environment"?: {
              default?: string;
              options?: string[];
              required?: boolean;
              type?: string;
            };
          };
        };
      };
    };

    const job = workflow.jobs["prepublication-publish-checks"];
    const testRelay = workflow.jobs["dispatch-test"];
    const invalidTarget = workflow.jobs["reject-test-target-on-staging-ref"];
    const steps = job.steps;
    expect(invalidTarget.if).toContain("github.ref == 'refs/heads/staging'");
    expect(invalidTarget.if).toContain("inputs['target-environment'] == 'test'");
    expect(
      invalidTarget.steps.find((step) => step.name === "Reject mismatched branch and target")?.run,
    ).toContain("exit 1");
    expect(workflow.on?.repository_dispatch?.types).toEqual(["clawhub-prepublication-publish"]);
    expect(workflow.on?.schedule?.[0]?.cron).toBe("*/5 * * * *");
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.on?.workflow_dispatch?.inputs?.["batch-limit"]).toMatchObject({
      required: true,
      default: "2",
    });
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
    expect(workflow.on?.workflow_dispatch?.inputs?.["target-environment"]).toEqual({
      description: "Convex deployment to process for manual recovery",
      required: true,
      default: "production",
      type: "choice",
      options: ["production", "test"],
    });
    expect(job.environment).toBe(
      "${{ github.ref == 'refs/heads/staging' && 'Staging' || (github.ref == 'refs/heads/main' && inputs['target-environment'] == 'test' && 'Test' || 'Production') }}",
    );
    expect(job["runs-on"]).toBe("${{ inputs.runner || 'blacksmith-8vcpu-ubuntu-2404' }}");
    expect(job["timeout-minutes"]).toBe(25);
    expect(job.strategy?.matrix?.shard).toBe(
      "${{ fromJSON((github.event_name == 'repository_dispatch' || (github.event_name == 'workflow_dispatch' && inputs['attempt-id'] != '')) && '[0]' || '[0,1]') }}",
    );
    expect(job.strategy?.["max-parallel"]).toBe(2);
    expect(job.env).toMatchObject({
      CONVEX_URL:
        "${{ github.ref == 'refs/heads/staging' && 'https://cheery-civet-733.convex.cloud' || (github.ref == 'refs/heads/main' && inputs['target-environment'] == 'test' && 'https://academic-chihuahua-392.convex.cloud' || vars.CONVEX_URL || vars.VITE_CONVEX_URL || 'https://wry-manatee-359.convex.cloud') }}",
      PREPUBLICATION_WORKER_ENVIRONMENT:
        "${{ github.ref == 'refs/heads/staging' && 'staging' || (github.ref == 'refs/heads/main' && inputs['target-environment'] == 'test' && 'test' || 'production') }}",
      PREPUBLICATION_CLAWSCAN_TIMEOUT_MS:
        "${{ vars.PREPUBLICATION_CLAWSCAN_TIMEOUT_MS || '900000' }}",
      PREPUBLICATION_CLAWSCAN_SANDBOX: "off",
      PREPUBLICATION_CHECK_ATTEMPT_ID:
        "${{ github.event.client_payload.attempt_id || inputs['attempt-id'] || '' }}",
      PREPUBLICATION_CHECK_LIMIT:
        "${{ github.event.client_payload.batch_limit || inputs['batch-limit'] || '2' }}",
      PREPUBLICATION_CHECK_KIND: "${{ github.event.client_payload.kind || inputs.kind || '' }}",
      PREPUBLICATION_CHECK_MAX_JOBS:
        "${{ github.event.client_payload.max_jobs || inputs['max-jobs'] || '' }}",
      PREPUBLICATION_CHECK_MAX_RUNTIME_MINUTES:
        "${{ github.event.client_payload.max_runtime_minutes || inputs['max-runtime-minutes'] || '15' }}",
      PREPUBLICATION_CHECK_SLUG: "${{ github.event.client_payload.slug || inputs.slug || '' }}",
      PREPUBLICATION_CHECK_VERSION:
        "${{ github.event.client_payload.version || inputs.version || '' }}",
      PREPUBLICATION_TRUFFLEHOG_IMAGE:
        "${{ vars.PREPUBLICATION_TRUFFLEHOG_IMAGE || 'ghcr.io/trufflesecurity/trufflehog:3.95.6@sha256:96f8429082cb2d4ae73b1096dcdb2f5aa139881d97042b0c5e5fa226a392e056' }}",
    });
    expect(String(job.env?.PREPUBLICATION_TRUFFLEHOG_IMAGE)).toContain("@sha256:");
    expect(workflow).toMatchObject({
      concurrency: {
        group:
          "${{ (github.ref == 'refs/heads/staging' || github.event.client_payload.environment == 'staging') && format('staging-{0}-', github.ref_name) || ((github.event.client_payload.environment == 'test' || inputs['target-environment'] == 'test') && 'test-' || '') }}${{ (github.event_name == 'repository_dispatch' || (github.event_name == 'workflow_dispatch' && inputs['attempt-id'] != '')) && format('clawhub-prepublication-{0}', github.event.client_payload.attempt_id || inputs['attempt-id']) || 'clawhub-prepublication-publish-checks' }}",
        "cancel-in-progress": false,
      },
    });
    expect(job.env).not.toHaveProperty("CODEX_API_KEY");
    expect(job.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(job.env).not.toHaveProperty("LLM_API_KEY");
    expect(job.env).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expect(job.env).not.toHaveProperty("CODEX_SECURITY_SCAN_TIMEOUT_MS");

    const testRunStep = steps.find(
      (step) => step.name === "Run Test pre-publication publish worker",
    );
    const runStep = steps.find((step) => step.name === "Run pre-publication publish worker");
    expect(testRunStep?.if).toBe(
      "github.ref == 'refs/heads/main' && inputs['target-environment'] == 'test'",
    );
    expect(testRunStep?.run).toContain("bun run publish:prepublication-worker");
    expect(testRunStep?.run).toContain("bunx convex env get SECURITY_SCAN_WORKER_TOKEN --prod");
    expect(testRunStep?.run).toContain("unset CONVEX_DEPLOY_KEY");
    expect(testRunStep?.run?.indexOf("unset CONVEX_DEPLOY_KEY")).toBeLessThan(
      testRunStep?.run?.indexOf("bun run publish:prepublication-worker") ?? -1,
    );
    expect(testRunStep?.env).toEqual({
      CODEX_API_KEY: "${{ secrets.CODEX_API_KEY || secrets.OPENAI_API_KEY }}",
      CONVEX_DEPLOY_KEY: "${{ secrets.CONVEX_DEPLOY_KEY }}",
      DEFAULT_BASE_URL: "https://api.openai.com/v1",
      DEFAULT_MODEL: "gpt-5.6",
      LLM_API_KEY: "${{ secrets.OPENAI_API_KEY || secrets.CODEX_API_KEY }}",
      OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}",
    });
    expect(testRunStep?.env).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expect(runStep?.if).toBe(
      "github.ref != 'refs/heads/main' || inputs['target-environment'] != 'test'",
    );
    expect(runStep?.run).toBe("bun run publish:prepublication-worker");
    expect(runStep?.run).not.toContain("--attempt-id");
    expect(runStep?.run).not.toContain("--kind");
    expect(runStep?.run).not.toContain("--slug");
    expect(runStep?.run).not.toContain("--version");
    expect(runStep?.run).not.toContain("--max-jobs");
    expect(steps.find((step) => step.name === "Install ClawScan CLI")?.run).toContain(
      "npm install -g @openclaw/clawscan@0.1.8",
    );
    const skillspectorInstall = steps.find((step) => step.name === "Install SkillSpector")?.run;
    expect(skillspectorInstall).toContain(
      "git+https://github.com/NVIDIA/skillspector.git@69dcdfb74487d361ba4c811d088cfdea2ff3a9dc",
    );
    expect(skillspectorInstall).toContain("skillspector --help");
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: "actions/setup-python@v7",
        with: { "python-version": "3.12" },
      }),
    );
    const aigInstall = steps.find((step) => step.name === "Install A.I.G scanner")?.run;
    expect(aigInstall).toContain(
      "python -m pip install --require-hashes -r scripts/security/aig-worker-requirements.txt",
    );
    expect(aigInstall).not.toContain("pip install 'aig-skill-scan==0.2.1'");
    expect(aigInstall).not.toContain('version("aig-skill-scan") == "0.2.1"');
    expect(aigInstall).toContain('version("aig-skill-scan") == "0.2.2"');
    expect(aigInstall).not.toContain("aig-skill-scan-0.2.1-gpt5.patch");
    expect(aigInstall).not.toContain("f18ae642d62be142192d6bd4c21c4ea7e098bbc8");
    expect(aigInstall).toContain('assert "temperature=" not in inspect.getsource(LLM.chat_stream)');
    expect(aigInstall).toContain("aig-skill-scan --help");
    expect(steps.find((step) => step.name === "Install Codex CLI")?.run).toContain(
      "npm install -g @openai/codex@0.142.3",
    );
    expect(steps.find((step) => step.name === "Authenticate Codex CLI")).toBeUndefined();
    expect(JSON.stringify(job)).not.toContain("CODEX_SECURITY_SCAN_SHADOW_CLAWSCAN");
    expect(runStep?.env).toEqual({
      CODEX_API_KEY: "${{ secrets.CODEX_API_KEY || secrets.OPENAI_API_KEY }}",
      DEFAULT_BASE_URL: "https://api.openai.com/v1",
      DEFAULT_MODEL: "gpt-5.6",
      LLM_API_KEY: "${{ secrets.OPENAI_API_KEY || secrets.CODEX_API_KEY }}",
      OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}",
      SECURITY_SCAN_WORKER_TOKEN: "${{ secrets.SECURITY_SCAN_WORKER_TOKEN }}",
    });

    expect(testRelay.permissions).toEqual({ actions: "write" });
    expect(testRelay.steps).toContainEqual(
      expect.objectContaining({
        name: "Dispatch Test worker",
        run: expect.stringContaining(
          "gh workflow run prepublication-publish-checks.yml --repo openclaw/clawhub --ref main",
        ),
      }),
    );
    expect(testRelay.steps.find((step) => step.name === "Dispatch Test worker")?.run).toContain(
      "-f target-environment=test",
    );
    expect(
      steps.find((step) => step.name === "Verify permanent Test worker target")?.run,
    ).toContain("https://academic-chihuahua-392.convex.cloud");

    for (const step of steps) {
      const stepName = step.name ?? step.uses ?? "<unnamed>";
      expect(stepUsesSecret(step, "SECURITY_SCAN_WORKER_TOKEN"), stepName).toBe(
        stepName === "Run pre-publication publish worker",
      );
      expect(stepUsesSecret(step, "CODEX_API_KEY"), stepName).toBe(
        stepName === "Run pre-publication publish worker" ||
          stepName === "Run Test pre-publication publish worker",
      );
      expect(stepUsesSecret(step, "OPENAI_API_KEY"), stepName).toBe(
        stepName === "Run pre-publication publish worker" ||
          stepName === "Run Test pre-publication publish worker",
      );
      expect(stepUsesSecret(step, "LLM_API_KEY"), stepName).toBe(
        stepName === "Run pre-publication publish worker" ||
          stepName === "Run Test pre-publication publish worker",
      );
      expect(stepUsesSecret(step, "VT_API_KEY"), stepName).toBe(false);
    }
  });
});
