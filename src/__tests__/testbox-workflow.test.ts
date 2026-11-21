import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadWorkflow } from "./helpers/githubWorkflowExpression";

describe("Testbox workflow", () => {
  it("keeps independent sessions on the same ref in separate concurrency groups", async () => {
    const workflow = loadWorkflow(await readFile(".github/workflows/ci-check-testbox.yml", "utf8"));
    const github = { ref: "refs/heads/main" };

    expect(workflow.concurrencyGroup({ github, inputs: { testbox_id: "session-one" } })).not.toBe(
      workflow.concurrencyGroup({ github, inputs: { testbox_id: "session-two" } }),
    );
  });

  it("groups repeated runs for the same session and ref", async () => {
    const workflow = loadWorkflow(await readFile(".github/workflows/ci-check-testbox.yml", "utf8"));
    const inputs = { testbox_id: "session-one" };

    expect(
      workflow.concurrencyGroup({ github: { ref: "refs/heads/main", run_id: 1 }, inputs }),
    ).toBe(workflow.concurrencyGroup({ github: { ref: "refs/heads/main", run_id: 2 }, inputs }));
  });
});
