/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  name?: string;
  run?: string;
};

describe("playwright local-auth workflow", () => {
  it("runs isolated local-auth shards concurrently and reports runner pressure", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/ci.yml", "utf8")) as {
      jobs: {
        "playwright-local-auth-shard": {
          "runs-on": string;
          steps: WorkflowStep[];
          strategy?: {
            "max-parallel"?: number;
            matrix?: { include?: Array<{ name?: string; specs?: string }> };
          };
        };
      };
    };
    const job = workflow.jobs["playwright-local-auth-shard"];

    expect(job["runs-on"]).toBe("blacksmith-16vcpu-ubuntu-2404");
    expect(job.strategy?.["max-parallel"]).toBe(8);
    expect(job.strategy?.matrix?.include?.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["moderation-malicious", "star-sync"]),
    );
    expect(
      job.strategy?.matrix?.include?.some(
        (entry) =>
          entry.specs?.includes("malicious-skill-ban-flow.pw.test.ts") &&
          entry.specs.includes("skill-star-sync.pw.test.ts"),
      ),
    ).toBe(false);

    const localAuthStep = job.steps.find((step) => step.name === "Local-auth browser e2e");
    expect(localAuthStep?.run).toContain("/sys/fs/cgroup/cpu.stat");
    expect(localAuthStep?.run).toContain("/proc/pressure/memory");
    expect(localAuthStep?.run).toContain("trap report_runner_pressure EXIT");
  });
});
