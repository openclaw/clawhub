/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("skill-card-worker workflow", () => {
  it("does not expose OPENAI_API_KEY to the artifact-processing worker step", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/skill-card-worker.yml", "utf8"),
    ) as {
      jobs: {
        "skill-card-worker": {
          env?: Record<string, unknown>;
          "timeout-minutes"?: number;
          strategy?: { matrix?: { shard?: number[] } };
          steps: Array<{ name?: string; env?: Record<string, unknown> }>;
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
    expect(workflow.concurrency).toEqual({
      group: "clawhub-skill-card-worker",
      "cancel-in-progress": false,
    });
    expect(job["timeout-minutes"]).toBe(60);
    expect(job.strategy?.matrix?.shard).toEqual([0, 1, 2, 3]);
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
    expect(job.steps.find((step) => step.name === "Authenticate Codex CLI")?.env).toHaveProperty(
      "OPENAI_API_KEY",
    );
    expect(
      job.steps.find((step) => step.name === "Run Skill Card worker")?.env ?? {},
    ).not.toHaveProperty("OPENAI_API_KEY");
  });
});
