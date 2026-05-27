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
          steps: Array<{ name?: string; env?: Record<string, unknown> }>;
        };
      };
    };
    const job = workflow.jobs["skill-card-worker"];

    expect(job.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(job.steps.find((step) => step.name === "Authenticate Codex CLI")?.env).toHaveProperty(
      "OPENAI_API_KEY",
    );
    expect(
      job.steps.find((step) => step.name === "Run Skill Card worker")?.env ?? {},
    ).not.toHaveProperty("OPENAI_API_KEY");
  });
});
