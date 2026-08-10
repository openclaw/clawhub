/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, string>;
  name?: string;
  run?: string;
};

const behaviorIt = process.platform === "win32" ? it.skip : it;

function executeExactReview(run: string, event: object, environment: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "clawhub-clawsweeper-dispatch-"));
  const eventPath = join(directory, "event.json");
  const capturePath = join(directory, "dispatch.json");
  const scriptPath = join(directory, "dispatch.sh");
  const ghPath = join(directory, "gh");

  try {
    writeFileSync(eventPath, JSON.stringify(event), "utf8");
    writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n${run}\n`, "utf8");
    writeFileSync(
      ghPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'test "$#" -eq 6',
        'test "$1" = "api"',
        'test "$2" = "repos/openclaw/clawsweeper/dispatches"',
        'test "$3" = "--method"',
        'test "$4" = "POST"',
        'test "$5" = "--input"',
        'test "$6" = "-"',
        'cat > "$GH_CAPTURE"',
      ].join("\n"),
      "utf8",
    );
    chmodSync(scriptPath, 0o755);
    chmodSync(ghPath, 0o755);

    const result = spawnSync("bash", [scriptPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ...environment,
        GH_CAPTURE: capturePath,
        GH_TOKEN: "proof-token",
        GITHUB_EVENT_PATH: eventPath,
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        SUPERSEDES_IN_PROGRESS: "false",
      },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return JSON.parse(readFileSync(capturePath, "utf8")) as {
      event_type: string;
      client_payload: Record<string, unknown>;
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("ClawSweeper dispatch workflow", () => {
  it("carries trusted branch authority and canonical PR ingress identity", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/clawsweeper-dispatch.yml", "utf8"),
    ) as {
      jobs: { dispatch: { steps: WorkflowStep[] } };
    };
    const exactReview = workflow.jobs.dispatch.steps.find(
      (step) => step.name === "Dispatch exact ClawSweeper review",
    );

    expect(exactReview?.env?.TARGET_BRANCH).toBe("${{ github.event.repository.default_branch }}");

    const run = exactReview?.run ?? "";
    expect(run).toContain('--arg target_branch "$TARGET_BRANCH"');
    expect(run).toContain("target_branch:$target_branch");
    expect(run).toContain('process.env.ITEM_KIND !== "pull_request"');
    expect(run).toContain("/^[0-9a-f]{40}$/.test(headSha)");
    expect(run).toContain("version: 1");
    expect(run).toContain('target_repo: String(process.env.TARGET_REPO || "").toLowerCase()');
    expect(run).toContain("item_number: Number(process.env.ITEM_NUMBER)");
    expect(run).toContain('action: String(process.env.SOURCE_ACTION || "")');
    expect(run).toContain("head_sha: headSha");
    expect(run).toContain("updated_at: updatedAt");
    expect(run).toContain('body: typeof pullRequest.body === "string" ? pullRequest.body : ""');
    expect(run).toContain('label: String(event.label?.name || "")');
    expect(run).toContain('ingress_route:"target_dispatcher"');
    expect(run).toContain("ingress_fingerprint:$ingress_fingerprint");
  });

  behaviorIt("serializes PR identity and leaves issue dispatches unpaired", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/clawsweeper-dispatch.yml", "utf8"),
    ) as {
      jobs: { dispatch: { steps: WorkflowStep[] } };
    };
    const run =
      workflow.jobs.dispatch.steps.find((step) => step.name === "Dispatch exact ClawSweeper review")
        ?.run ?? "";
    const pullRequest = {
      head: { sha: "A".repeat(40) },
      updated_at: "2026-08-10T22:00:00Z",
      body: "proof body",
    };
    const prPayload = executeExactReview(
      run,
      { pull_request: pullRequest, label: { name: "proof: sufficient" } },
      {
        TARGET_REPO: "openclaw/clawhub",
        TARGET_BRANCH: "trunk",
        ITEM_NUMBER: "3359",
        ITEM_KIND: "pull_request",
        SOURCE_EVENT: "pull_request_target",
        SOURCE_ACTION: "synchronize",
      },
    );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          target_repo: "openclaw/clawhub",
          item_number: 3359,
          action: "synchronize",
          head_sha: "a".repeat(40),
          updated_at: pullRequest.updated_at,
          body: pullRequest.body,
          label: "proof: sufficient",
        }),
      )
      .digest("hex");
    expect(prPayload).toEqual({
      event_type: "clawsweeper_item",
      client_payload: {
        target_repo: "openclaw/clawhub",
        target_branch: "trunk",
        item_number: 3359,
        item_kind: "pull_request",
        source_event: "pull_request_target",
        source_action: "synchronize",
        supersedes_in_progress: false,
        ingress_route: "target_dispatcher",
        ingress_fingerprint: fingerprint,
      },
    });

    const issuePayload = executeExactReview(
      run,
      { issue: { number: 3360 } },
      {
        TARGET_REPO: "openclaw/clawhub",
        TARGET_BRANCH: "trunk",
        ITEM_NUMBER: "3360",
        ITEM_KIND: "issue",
        SOURCE_EVENT: "issues",
        SOURCE_ACTION: "opened",
      },
    );
    expect(issuePayload.client_payload).toEqual({
      target_repo: "openclaw/clawhub",
      target_branch: "trunk",
      item_number: 3360,
      item_kind: "issue",
      source_event: "issues",
      source_action: "opened",
      supersedes_in_progress: false,
    });
  });
});
