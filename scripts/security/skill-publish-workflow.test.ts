/* @vitest-environment node */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const workflow = parseYaml(readFileSync(".github/workflows/skill-publish.yml", "utf8")) as {
  jobs: { publish: { steps: Array<{ name?: string; run?: string }> } };
};
const publishStep = workflow.jobs.publish.steps.find(
  (step: { name?: string }) => step.name === "Run skill publishes",
);
const moveStep = workflow.jobs.publish.steps.find(
  (step: { name?: string }) => step.name === "Move ClawHub source out of the caller workspace",
);

function runPublish(stdout: string, { skillPath = "" } = {}) {
  mkdirSync(".artifacts", { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".artifacts/skill-publish-test-"));
  try {
    // Separate dirs, as on a real runner. actions/checkout puts the ClawHub source inside the
    // caller's workspace; the workflow must move it to RUNNER_TEMP before publishing, or a skill
    // at the repository root uploads it as its own files.
    const workspace = join(root, "workspace");
    const runnerTemp = join(root, "runner-temp");
    mkdirSync(runnerTemp, { recursive: true });
    const bin = join(root, "bin");
    mkdirSync(bin);
    const fakeBun = join(bin, "bun");
    writeFileSync(
      fakeBun,
      [
        "#!/usr/bin/env python3",
        "import json, os, sys",
        'seen = {"argv": sys.argv[1:], "checkoutInWorkspace": os.path.exists("clawhub-source")}',
        'open(os.environ["PUBLISH_TEST_SEEN"], "w").write(json.dumps(seen))',
        'print(os.environ["PUBLISH_TEST_STDOUT"])',
        "",
      ].join("\n"),
    );
    chmodSync(fakeBun, 0o755);
    const skillDir = skillPath ? join(workspace, skillPath) : join(workspace, "skills", "demo");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Demo\n");
    const seenFile = join(runnerTemp, "bun-seen.json");
    const cliDir = join(workspace, "clawhub-source", "packages", "clawhub", "src");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "cli.ts"), "// CLI subprocess is a receipt fixture.\n");
    if (!publishStep?.run || !moveStep?.run) throw new Error("Missing skill publish workflow step");
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: runnerTemp,
      INPUT_SKILL_PATH: skillPath,
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
      PUBLISH_TEST_SEEN: seenFile,
    };
    let status: number | null = null;
    for (const step of [moveStep, publishStep]) {
      const child = spawnSync("bash", ["-c", step.run], { cwd: workspace, encoding: "utf8", env });
      if (child.error) throw child.error;
      if (step === publishStep) status = child.status;
    }
    const output = JSON.parse(readFileSync(join(runnerTemp, "skill-publish.json"), "utf8"));
    const seen = JSON.parse(readFileSync(seenFile, "utf8")) as {
      argv: string[];
      checkoutInWorkspace: boolean;
    };
    return { status, output, seen, workspace };
  } finally {
    rmSync(root, { recursive: true, force: true });
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

  it("publishes a repository-root skill with the CLI outside the caller workspace", () => {
    const receipt = {
      status: "published",
      slug: "demo",
      version: "1.0.0",
      attemptId: "fixture-attempt",
    };
    const result = runPublish(JSON.stringify(receipt), { skillPath: "." });
    expect(result.status).toBe(0);
    expect(result.output.published).toEqual([receipt]);
    expect(result.seen.checkoutInWorkspace).toBe(false);
    const [cliEntry, , workdir] = result.seen.argv;
    expect(workdir).toBe(result.workspace);
    expect(relative(result.workspace, cliEntry).startsWith("..")).toBe(true);
    expect(result.seen.argv[result.seen.argv.indexOf("publish") + 1]).toBe(".");
  });
});
