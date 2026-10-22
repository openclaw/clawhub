/* @vitest-environment node */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const workflow = parseYaml(readFileSync(".github/workflows/skill-publish.yml", "utf8")) as {
  jobs: { publish: { steps: Array<{ name?: string; run?: string }> } };
};
const publishStep = workflow.jobs.publish.steps.find(
  (step: { name?: string }) => step.name === "Run skill publishes",
);

function runPublish(stdout: string) {
  mkdirSync(".artifacts", { recursive: true });
  const workspace = mkdtempSync(join(process.cwd(), ".artifacts/skill-publish-test-"));
  try {
    const bin = join(workspace, "bin");
    mkdirSync(bin);
    const fakeBun = join(bin, "bun");
    writeFileSync(
      fakeBun,
      '#!/usr/bin/env python3\nimport os\nprint(os.environ["PUBLISH_TEST_STDOUT"])\n',
    );
    chmodSync(fakeBun, 0o755);
    mkdirSync(join(workspace, "skills", "demo"), { recursive: true });
    writeFileSync(join(workspace, "skills", "demo", "SKILL.md"), "# Demo\n");
    const cliDir = join(workspace, "clawhub-source", "packages", "clawhub", "src");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "cli.ts"), "// CLI subprocess is a receipt fixture.\n");
    if (!publishStep?.run) throw new Error("Missing skill publish workflow step");
    const child = spawnSync("bash", ["-c", publishStep.run], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_WORKSPACE: workspace,
        RUNNER_TEMP: workspace,
        INPUT_SKILL_PATH: "",
        INPUT_ROOT: "skills",
        INPUT_DRY_RUN: "false",
        INPUT_OWNER: "",
        INPUT_TAGS: "",
        INPUT_CHANGELOG: "",
        INPUT_CATEGORIES: "",
        INPUT_TOPICS: "",
        INPUT_CLEAR_CATEGORIES: "false",
        INPUT_CLEAR_TOPICS: "false",
        INPUT_SITE: "https://example.invalid",
        INPUT_REGISTRY: "https://example.invalid",
        INPUT_REF: "",
        SOURCE_REF: "refs/heads/main",
        SOURCE_REPOSITORY: "fixture/demo",
        PUBLISH_TEST_STDOUT: stdout,
      },
    });
    if (child.error) throw child.error;
    const output = JSON.parse(readFileSync(join(workspace, "skill-publish.json"), "utf8"));
    return { status: child.status, output };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("skill publish workflow receipts", () => {
  it.each([
    ["pending-publication", "pendingPublication"],
    ["submitted", "submitted"],
    ["published", "published"],
    ["would-publish", "wouldPublish"],
    ["unchanged", "alreadySynced"],
  ])("accepts %s without confusing acceptance with publication", (status, bucket) => {
    const receipt = { status, slug: "demo", version: "1.0.0", attemptId: "fixture-attempt" };
    const result = runPublish(JSON.stringify(receipt));
    expect(result.status).toBe(0);
    expect(result.output.ok).toBe(true);
    expect(result.output[bucket]).toEqual([receipt]);
    expect(result.output.summary.failed).toBe(0);
    expect(result.output.summary.published).toBe(status === "published" ? 1 : 0);
  });

  it.each(['{"status":"unknown"}', "not JSON"])("still rejects invalid receipts: %s", (stdout) => {
    const result = runPublish(stdout);
    expect(result.status).toBe(1);
    expect(result.output.ok).toBe(false);
    expect(result.output.summary.failed).toBe(1);
  });
});
