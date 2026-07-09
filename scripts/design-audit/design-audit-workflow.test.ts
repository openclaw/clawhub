/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type Step = {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

describe("weekly design-system audit workflow", () => {
  it("runs Monday and manually, with one guarded draft PR branch", async () => {
    const source = await readFile(".github/workflows/design-system-audit.yml", "utf8");
    const workflow = parseYaml(source) as {
      on: {
        schedule: Array<{ cron: string }>;
        workflow_dispatch: unknown;
      };
      env: Record<string, string>;
      jobs: { audit: { steps: Step[] } };
    };
    const steps = workflow.jobs.audit.steps;

    expect(workflow.on.schedule).toEqual([{ cron: "17 15 * * 1" }]);
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.env.AUDIT_BRANCH).toBe("automation/design-system-audit");
    expect(source.toLowerCase()).not.toContain("linear");
    expect(source).not.toContain("gh pr merge");

    const createPr = steps.find((step) => step.name === "Open or update draft pull request");
    expect(createPr?.run).toContain("--draft");
    expect(createPr?.run).toContain("gh pr edit");
    expect(createPr?.run).toContain('--head "$AUDIT_BRANCH"');

    const closeClean = steps.find(
      (step) => step.name === "Close obsolete clean audit pull request",
    );
    expect(closeClean?.if).toContain("steps.validation.outcome == 'success'");
    expect(closeClean?.run).toContain("gh pr close");
  });

  it("preserves artifacts and suppresses PRs when validation fails", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/design-system-audit.yml", "utf8"),
    ) as { jobs: { audit: { steps: Step[] } } };
    const steps = workflow.jobs.audit.steps;
    const upload = steps.find((step) => step.name === "Upload audit artifacts");
    const commit = steps.find((step) => step.name === "Commit audit branch");
    const failure = steps.find((step) => step.name === "Fail unsuccessful audit");

    expect(upload?.if).toBe("always()");
    expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
    expect(commit?.if).toBe("steps.finalize.outputs.open_pr == 'true'");
    expect(failure?.if).toContain("steps.validation.outcome == 'failure'");
  });

  it("pins the design release and audit inputs in every report", async () => {
    const source = await readFile(".github/workflows/design-system-audit.yml", "utf8");
    expect(source).toContain("repos/openclaw/design-system/releases/latest");
    expect(source).toContain('"https://github.com/"');
    expect(source).toContain('git clone \\\n            --branch "$release"');
    expect(source).toContain("--consumer-sha");
    expect(source).toContain("--base-sha");
    expect(source).toContain("--release");
    expect(source).toContain("browser-check.ts");
    expect(source).toContain("run-codex.ts");
    expect(source).toContain(
      "set -euo pipefail\n          {\n            bun run test:ui-contract",
    );
  });
});
