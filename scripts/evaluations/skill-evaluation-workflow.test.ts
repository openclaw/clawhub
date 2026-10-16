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

describe("skill evaluation workflow", () => {
  it("runs the pinned release on an isolated production worker", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/skill-evaluation.yml", "utf8"),
    ) as {
      jobs: {
        evaluate: {
          concurrency?: { "cancel-in-progress"?: boolean; group?: string };
          env?: Record<string, unknown>;
          environment?: string;
          strategy?: { "fail-fast"?: boolean; matrix?: { worker: number[] } };
          "runs-on"?: string;
          steps: WorkflowStep[];
          "timeout-minutes"?: number;
        };
      };
      on?: {
        repository_dispatch?: { types?: string[] };
        schedule?: unknown;
        workflow_dispatch?: unknown;
      };
    };
    const job = workflow.jobs.evaluate;
    const install = job.steps.find((step) => step.name === "Install pinned SkillEvaluator release");
    const installCodex = job.steps.find((step) => step.name === "Install pinned Codex CLI");
    const run = job.steps.find((step) => step.name === "Run skill evaluation worker");

    expect(workflow.on?.repository_dispatch?.types).toEqual(["clawhub-skill-evaluation"]);
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.on?.schedule).toBeUndefined();
    expect(job.steps[0]).toMatchObject({
      uses: "actions/checkout@v7.0.1",
      with: { "persist-credentials": false },
    });
    expect(job["runs-on"]).toBe("blacksmith-16vcpu-ubuntu-2404");
    expect(job.environment).toBe("Production");
    expect(job["timeout-minutes"]).toBe(360);
    expect(job.concurrency).toEqual({
      group: "clawhub-skill-evaluation-worker-${{ matrix.worker }}",
      "cancel-in-progress": false,
    });
    expect(job.strategy).toEqual({
      "fail-fast": false,
      matrix: { worker: Array.from({ length: 64 }, (_, index) => index + 1) },
    });
    expect(job.env?.SKILL_EVALUATION_WORKER_ID).toContain("${{ matrix.worker }}");
    expect(install?.run).toContain("--branch v0.5.0");
    expect(install?.run).toContain("7304d76cde371287b67ea99653409d014b6b9c85");
    expect(install?.run).toContain("uv sync");
    expect(install?.run).toContain("--extra tier3 --frozen");
    expect(job.env).not.toHaveProperty("SKILL_EVALUATOR_DIR");
    expect(install?.env).toEqual({
      SKILL_EVALUATOR_DIR: "${{ runner.temp }}/SkillEvaluator",
    });
    expect(installCodex?.run).toContain("npm install -g @openai/codex@0.148.0");
    expect(installCodex?.run).toContain("codex --version");
    expect(installCodex?.run).not.toContain("@latest");
    expect(job.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(job.env).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expect(run?.env).toEqual({
      OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}",
      SECURITY_SCAN_WORKER_TOKEN: "${{ secrets.SECURITY_SCAN_WORKER_TOKEN }}",
      SKILL_EVALUATOR_DIR: "${{ runner.temp }}/SkillEvaluator",
    });
    expect(run?.run).toBe("bun scripts/evaluations/run-skill-evaluation-worker.ts");
  });
});
