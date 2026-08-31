/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowJob = {
  "runs-on": string;
  "timeout-minutes": number;
  needs?: string;
  steps: Array<{
    name?: string;
    run?: string;
    uses?: string;
    with?: Record<string, number | string>;
  }>;
};

describe("CI workflow", () => {
  it("runs required gates in parallel with one CPU-sized Blacksmith lane", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/ci.yml", "utf8")) as {
      jobs: Record<string, WorkflowJob>;
    };
    const requiredGates = {
      static: "bun run ci:static",
      unit: "bun run ci:unit",
      packages: "bun run ci:packages",
      "types-build": "bun run ci:types-build",
      "e2e-http": "bun run ci:e2e-http",
    };

    expect(workflow.jobs["pr-gates"]).toBeUndefined();
    for (const [name, command] of Object.entries(requiredGates)) {
      const job = workflow.jobs[name];
      expect(job.needs).toBeUndefined();
      expect(job["timeout-minutes"]).toBe(5);
      expect(job.steps).toContainEqual(expect.objectContaining({ run: command }));
    }

    expect(workflow.jobs.unit["runs-on"]).toBe("blacksmith-32vcpu-ubuntu-2404");
    expect(workflow.jobs.unit.steps).toContainEqual(
      expect.objectContaining({
        uses: "actions/checkout@v7.0.1",
        with: { "fetch-depth": 2 },
      }),
    );
    for (const name of ["static", "packages", "types-build", "e2e-http"]) {
      expect(workflow.jobs[name]["runs-on"]).toBe("ubuntu-24.04");
    }

    const capacityStep = workflow.jobs.unit.steps.find(
      (step) => step.name === "Record runner capacity",
    );
    expect(capacityStep?.run).toContain("nproc");
    expect(capacityStep?.run).toContain("/sys/fs/cgroup/cpu.stat");
  });
});
