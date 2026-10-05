/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, unknown>;
  name?: string;
  run?: string;
};

type WorkflowJob = {
  env?: Record<string, unknown>;
  environment?: { name?: string } | string;
  needs?: string;
  steps: WorkflowStep[];
};

type Workflow = {
  jobs: Record<string, WorkflowJob>;
  on: Record<string, { inputs?: Record<string, { required?: boolean; type?: string }> }>;
  permissions?: Record<string, string>;
};

async function readWorkflow(path: string): Promise<Workflow> {
  return parseYaml(await readFile(path, "utf8")) as Workflow;
}

function step(job: WorkflowJob, name: string) {
  return job.steps.find((candidate) => candidate.name === name);
}

describe("Test Claw canary prepublication workflow", () => {
  it("only dispatches from main for one exact Test canary attempt", async () => {
    const workflow = await readWorkflow(".github/workflows/test-claw-canary-prepublication.yml");
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch?.inputs?.attempt_id).toMatchObject({
      required: true,
      type: "string",
    });
    expect(workflow.permissions).toEqual({ contents: "read" });

    const validation = workflow.jobs["validate-request"];
    expect(validation.environment).toBeUndefined();
    expect(step(validation, "Require main and an exact attempt ID")?.run).toContain(
      '"$GITHUB_REF" != "refs/heads/main"',
    );
    expect(step(validation, "Require main and an exact attempt ID")?.run).toContain(
      '"$ATTEMPT_ID" =~ ^[a-z0-9]{32}$',
    );

    const check = workflow.jobs["check-test-attempt"];
    expect(check.needs).toBe("validate-request");
    expect(check.environment).toEqual({ name: "Test" });
    expect(check.env?.CONVEX_URL).toBe("https://academic-chihuahua-392.convex.cloud");
    expect(check.env).not.toHaveProperty("CONVEX_DEPLOY_KEY");

    const targetGuard = step(check, "Verify permanent Test backend");
    expect(targetGuard?.env?.CONVEX_DEPLOY_KEY).toBe("${{ secrets.CONVEX_DEPLOY_KEY }}");
    expect(targetGuard?.run).toContain("prod:academic-chihuahua-392\\|*");
    expect(targetGuard?.run).toContain("convex env get CLAWHUB_ENV --prod");
    expect(targetGuard?.run).toContain("appMeta:getDeploymentInfo --prod");
    expect(targetGuard?.run).toContain('"$build_sha" != "$GITHUB_SHA"');

    const worker = step(check, "Run exact Test Claw publish checks");
    expect(worker?.env?.CONVEX_DEPLOY_KEY).toBe("${{ secrets.CONVEX_DEPLOY_KEY }}");
    expect(worker?.env?.OPENAI_API_KEY).toBe("${{ secrets.OPENAI_API_KEY }}");
    expect(worker?.run).toContain('.name == "@openclaw/hosted-e2e-canary"');
    expect(worker?.run).toContain("convex env get SECURITY_SCAN_WORKER_TOKEN --prod");
    expect(worker?.run).toContain('SECURITY_SCAN_WORKER_TOKEN="$worker_token"');
    expect(worker?.run).toContain('--attempt-id "$ATTEMPT_ID"');
    expect(worker?.run).toContain("--kind package");
    expect(worker?.run).toContain("--batch-limit 1");
    expect(worker?.run).toContain("--max-jobs 1");
    expect(worker?.run).toContain('.status == "finalized"');
    expect(worker?.run).toContain('.checks.trufflehog.status == "clean"');
    expect(worker?.run).toContain('.checks.clawscan.status == "clean"');
    expect(JSON.stringify(workflow)).not.toContain("secrets.SECURITY_SCAN_WORKER_TOKEN");
  });

  it("uses the pinned production prepublication scanner setup", async () => {
    const test = await readWorkflow(".github/workflows/test-claw-canary-prepublication.yml");
    const production = await readWorkflow(".github/workflows/prepublication-publish-checks.yml");
    const testJob = test.jobs["check-test-attempt"];
    const productionJob = production.jobs["prepublication-publish-checks"];

    for (const name of [
      "Install Codex CLI",
      "Install ClawScan CLI",
      "Install SkillSpector",
      "Install A.I.G scanner",
    ]) {
      expect(step(testJob, name)?.run).toBe(step(productionJob, name)?.run);
    }
    const trufflehogDigest =
      productionJob.env?.PREPUBLICATION_TRUFFLEHOG_IMAGE?.toString().match(
        /@sha256:[a-f0-9]{64}/,
      )?.[0];
    expect(trufflehogDigest).toBeDefined();
    expect(testJob.env?.PREPUBLICATION_TRUFFLEHOG_IMAGE).toContain(trufflehogDigest);
  });
});
