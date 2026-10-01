import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, string>;
  name?: string;
};

type WorkflowJob = {
  concurrency?: {
    group?: string;
    "cancel-in-progress"?: boolean;
  };
  steps?: WorkflowStep[];
};

async function readWorkflow() {
  return parseYaml(await readFile(".github/workflows/scheduled-live-checks.yml", "utf8")) as {
    jobs?: Record<string, WorkflowJob>;
  };
}

describe("scheduled live checks workflow", () => {
  it("serializes failure issue updates across refs", async () => {
    const workflow = await readWorkflow();

    expect(workflow.jobs?.["open-failure-issue"]?.concurrency).toEqual({
      group: "clawhub-scheduled-live-checks-failure-issue",
      "cancel-in-progress": false,
    });
  });

  it("runs the GitHub-backed canary with Test-only rollout capabilities", async () => {
    const workflow = await readWorkflow();
    const canary = workflow.jobs?.["github-backed-skills"]?.steps?.find(
      (step) => step.name === "Run GitHub-backed skills live canary",
    );

    expect(canary?.env).toMatchObject({
      CLAWHUB_ENV: "test",
      CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "test",
    });
  });
});
