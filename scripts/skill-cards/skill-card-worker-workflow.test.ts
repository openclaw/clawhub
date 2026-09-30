/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, unknown>;
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

describe("skill-card-worker workflow", () => {
  it("isolates fixture dispatch from queue draining and backend credentials", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/skill-card-worker.yml", "utf8"));
    expect(workflow.on.workflow_dispatch.inputs["fixture-only"]).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(workflow.jobs["skill-card-worker"].if).toBe(
      "${{ github.event_name != 'workflow_dispatch' || inputs.fixture-only != true }}",
    );
    const fixture = workflow.jobs.fixture;
    expect(fixture.if).toBe(
      "${{ github.event_name == 'workflow_dispatch' && inputs.fixture-only == true }}",
    );
    expect(fixture.environment).toBe("Production");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(fixture.env).toBeUndefined();
    expectSecretStepAllowlist(fixture.steps, "OPENAI_API_KEY", ["Authenticate Codex CLI"]);
    expectSecretStepAllowlist(fixture.steps, "SECURITY_SCAN_WORKER_TOKEN", []);
    expectSecretStepAllowlist(fixture.steps, "CONVEX_DEPLOY_KEY", []);
    expect(JSON.stringify(fixture)).not.toMatch(
      /CONVEX_URL|VITE_CONVEX_URL|upload-artifact|run-skill-card-worker/,
    );
    expect(fixture.steps.at(-1).run).toBe("bun scripts/skill-cards/credential-canary.ts");
  });

  it("does not expose OPENAI_API_KEY to the artifact-processing worker step", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/skill-card-worker.yml", "utf8"),
    ) as {
      jobs: {
        "skill-card-worker": {
          env?: Record<string, unknown>;
          "timeout-minutes"?: number;
          strategy?: { matrix?: { shard?: number[] } };
          steps: WorkflowStep[];
        };
      };
      concurrency?: unknown;
      on?: {
        workflow_dispatch?: {
          inputs?: Record<string, { default?: string }>;
        };
      };
    };
    const job = workflow.jobs["skill-card-worker"];

    expect(workflow.on?.workflow_dispatch?.inputs?.["batch-limit"]?.default).toBe("4");
    expect(workflow.on?.workflow_dispatch?.inputs?.["max-runtime-minutes"]?.default).toBe("40");
    expect(workflow.concurrency).toBeUndefined();
    expect(job["timeout-minutes"]).toBe(60);
    expect(job.strategy?.matrix?.shard).toEqual([0, 1, 2, 3]);
    expect(job.env?.CONVEX_URL).toBe(
      "${{ vars.CONVEX_URL || vars.VITE_CONVEX_URL || 'https://wry-manatee-359.convex.cloud' }}",
    );
    expect(job.env?.SKILL_CARD_WORKER_LIMIT).toBe(
      "${{ github.event.inputs['batch-limit'] || '4' }}",
    );
    expect(job.env?.SKILL_CARD_WORKER_MAX_RUNTIME_MINUTES).toBe(
      "${{ github.event.inputs['max-runtime-minutes'] || '40' }}",
    );
    expect(job.env?.SKILL_CARD_WORKER_LEASE_MINUTES).toBe("60");
    expect(job.env?.SKILL_CARD_WORKER_SHARD).toBe("${{ matrix.shard }}");
    expect(job.env?.SKILL_CARD_WORKER_ID).toBe(
      "github-actions:${{ github.run_id }}:${{ github.run_attempt }}:${{ matrix.shard }}",
    );
    expect(job.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(job.env).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    const checkConfiguration = job.steps.find((step) => step.name === "Check configuration");
    expect(checkConfiguration?.run).toContain('if [[ -z "$CONVEX_URL" ]]');
    expect(checkConfiguration?.run).toContain("exit 1");
    expectSecretStepAllowlist(job.steps, "OPENAI_API_KEY", ["Authenticate Codex CLI"]);
    expectSecretStepAllowlist(job.steps, "SECURITY_SCAN_WORKER_TOKEN", ["Run Skill Card worker"]);
    expect(job.steps.find((step) => step.name === "Authenticate Codex CLI")?.env).toHaveProperty(
      "OPENAI_API_KEY",
    );
    expect(
      job.steps.find((step) => step.name === "Run Skill Card worker")?.env ?? {},
    ).not.toHaveProperty("OPENAI_API_KEY");
    expect(job.steps.find((step) => step.name === "Run Skill Card worker")?.env).toHaveProperty(
      "SECURITY_SCAN_WORKER_TOKEN",
    );
    const dependenciesInstall = job.steps.find(
      (step) => step.name === "Install Codex CLI and renderer dependencies",
    )?.run;
    expect(dependenciesInstall).toContain("npm install -g @openai/codex@0.142.3");
    expect(dependenciesInstall).toContain(
      "python3 -m pip install --user --retries 5 --timeout 60 'jinja2==3.1.6'",
    );
    expect(dependenciesInstall).not.toContain("@latest");
    expect(dependenciesInstall).not.toMatch(/pip install --user jinja2(?:\s|$)/);
  });
});
