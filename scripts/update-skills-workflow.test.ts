/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  "continue-on-error"?: boolean;
  env?: Record<string, unknown>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

describe("update skills workflow", () => {
  it("uses GitHub App auth only for pull request mutations", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/update-skills.yml", "utf8")) as {
      jobs: {
        update: {
          steps: WorkflowStep[];
        };
      };
      permissions?: Record<string, string>;
    };

    expect(workflow.permissions).toEqual({ contents: "write" });

    const steps = workflow.jobs.update.steps;
    const provenanceStep = steps.find((step) => step.name === "Refresh changed skill provenance");
    expect(provenanceStep?.env).toEqual({ GH_TOKEN: "${{ github.token }}" });

    const pushStep = steps.find((step) => step.name === "Commit and push update branch");
    expect(pushStep?.env).toEqual({ GH_TOKEN: "${{ github.token }}" });
    expect(pushStep?.run).toContain('git push --force-with-lease origin "$branch"');
    expect(pushStep?.run).not.toContain("gh pr ");

    const primaryTokenStep = steps.find((step) => step.id === "app-token");
    expect(primaryTokenStep).toMatchObject({
      uses: "actions/create-github-app-token@1b10c78c7865c340bc4f6099eb2f838309f1e8c3",
      "continue-on-error": true,
      if: "steps.changes.outputs.changed == 'true'",
      with: {
        "app-id": "2729701",
        "private-key": "${{ secrets.GH_APP_PRIVATE_KEY }}",
        owner: "${{ github.repository_owner }}",
        repositories: "${{ github.event.repository.name }}",
        "permission-pull-requests": "write",
      },
    });

    const fallbackTokenStep = steps.find((step) => step.id === "app-token-fallback");
    expect(fallbackTokenStep).toMatchObject({
      uses: "actions/create-github-app-token@1b10c78c7865c340bc4f6099eb2f838309f1e8c3",
      "continue-on-error": true,
      if: "steps.changes.outputs.changed == 'true' && steps.app-token.outcome == 'failure'",
      with: {
        "app-id": "2971289",
        "private-key": "${{ secrets.GH_APP_PRIVATE_KEY_FALLBACK }}",
        owner: "${{ github.repository_owner }}",
        repositories: "${{ github.event.repository.name }}",
        "permission-pull-requests": "write",
      },
    });

    const pullRequestStep = steps.find((step) => step.name === "Open or update pull request");
    expect(pullRequestStep?.env).toEqual({
      GH_TOKEN: "${{ steps.app-token.outputs.token || steps.app-token-fallback.outputs.token }}",
    });
    const pullRequestRun = pullRequestStep?.run ?? "";
    expect(pullRequestRun).toContain("gh pr list");
    expect(pullRequestRun).toContain("gh pr edit");
    expect(pullRequestRun).toContain("gh pr create");
    expect(pullRequestRun).not.toContain("git push");
    expect(JSON.stringify(pullRequestStep)).not.toContain("github.token");

    const tokenGuard = 'if [[ -z "${GH_TOKEN:-}" ]]';
    expect(pullRequestRun).toContain(tokenGuard);
    expect(pullRequestRun).toContain("primary GH_APP_PRIVATE_KEY");
    expect(pullRequestRun).toContain("fallback GH_APP_PRIVATE_KEY_FALLBACK");
    expect(pullRequestRun.indexOf(tokenGuard)).toBeLessThan(pullRequestRun.indexOf("gh pr list"));
  });
});
