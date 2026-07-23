import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, string>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
};

type WorkflowJob = {
  environment?: { name?: string; url?: string };
  if?: string;
  steps?: WorkflowStep[];
};

async function readWorkflow() {
  return parseYaml(await readFile(".github/workflows/deploy-test.yml", "utf8")) as {
    concurrency?: {
      group?: string;
      "cancel-in-progress"?: boolean;
    };
    jobs?: Record<string, WorkflowJob>;
    on?: {
      pull_request?: {
        types?: string[];
      };
      workflow_dispatch?: unknown;
      workflow_run?: {
        branches?: string[];
        types?: string[];
        workflows?: string[];
      };
    };
    permissions?: Record<string, string>;
  };
}

describe("Test deploy workflow", () => {
  it("admits main CI and exact guarded CLAW-563 branch deploys", async () => {
    const workflow = await readWorkflow();
    const job = workflow.jobs?.["deploy-test"];
    const steps = job?.steps ?? [];
    const revision = steps.find((step) => step.name === "Resolve deployment revision")?.run ?? "";

    expect(workflow.on?.workflow_run).toEqual({
      workflows: ["CI"],
      types: ["completed"],
      branches: ["main"],
    });
    expect(workflow.on?.pull_request).toEqual({
      types: ["opened", "reopened", "synchronize", "labeled"],
    });
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.concurrency).toEqual({
      group: "deploy-test",
      "cancel-in-progress": false,
    });
    expect(job?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(job?.if).toContain("github.ref == 'refs/heads/main'");
    expect(job?.if).toContain("github.ref == 'refs/heads/pe/claw-563-skills-sh-mirror-10k'");
    expect(job?.if).toContain("inputs.branch_test_confirm == 'deploy-claw-563-to-permanent-test'");
    expect(job?.if).toContain("inputs.expected_sha != ''");
    expect(job?.if).toContain("github.event_name == 'pull_request'");
    expect(job?.if).toContain(
      "github.event.pull_request.head.ref == 'pe/claw-563-skills-sh-mirror-10k'",
    );
    expect(job?.if).toContain("github.actor == 'Patrick-Erichsen'");
    expect(job?.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(job?.if).toContain("github.event.workflow_run.event == 'push'");
    expect(revision).toContain('deploy_sha" != "$main_sha');
    expect(revision).toContain("refs/heads/pe/claw-563-skills-sh-mirror-10k");
    expect(revision).toContain("Patrick-Erichsen");
    expect(revision).toContain("deploy-claw-563-to-permanent-test");
    expect(revision).toContain("${{ inputs.expected_sha }}");
    expect(revision).toContain("${{ github.event.pull_request.head.sha }}");
  });

  it("uses only the Test environment and narrowly scoped secrets", async () => {
    const workflow = await readWorkflow();
    const job = workflow.jobs?.["deploy-test"];
    const steps = job?.steps ?? [];

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job?.environment).toEqual({
      name: "Test",
      url: "${{ vars.SITE_URL }}",
    });
    expect(steps.filter((step) => step.env?.CONVEX_DEPLOY_KEY).map((step) => step.name)).toEqual([
      "Check Test configuration",
      "Enable Test rollout modes",
      "Stamp Convex build SHA",
      "Stamp Convex deploy time",
      "Deploy Convex Test",
      "Verify Convex contract",
      "Verify Test rollout capabilities",
      "Apply additive Test fixtures",
    ]);
    expect(steps.filter((step) => step.env?.VERCEL_TOKEN).map((step) => step.name)).toEqual([
      "Check Test configuration",
      "Deploy unpromoted Vercel Test candidate",
      "Assign stable Test alias",
    ]);
    expect(steps.find((step) => step.name === "Check Test configuration")?.run).toContain(
      "prod:academic-chihuahua-392\\|*",
    );
  });

  it("smokes the candidate before assigning the stable alias and verifies it afterward", async () => {
    const workflow = await readWorkflow();
    const steps = workflow.jobs?.["deploy-test"]?.steps ?? [];
    const indexOf = (name: string) => steps.findIndex((step) => step.name === name);
    const deployStep = steps.find(
      (step) => step.name === "Deploy unpromoted Vercel Test candidate",
    );
    const aliasStep = steps.find((step) => step.name === "Assign stable Test alias");

    expect(indexOf("Deploy Convex Test")).toBeGreaterThanOrEqual(0);
    expect(indexOf("Apply additive Test fixtures")).toBeGreaterThan(indexOf("Deploy Convex Test"));
    expect(indexOf("Deploy unpromoted Vercel Test candidate")).toBeGreaterThan(
      indexOf("Apply additive Test fixtures"),
    );
    expect(indexOf("Smoke Test candidate HTTP")).toBeGreaterThan(
      indexOf("Deploy unpromoted Vercel Test candidate"),
    );
    expect(indexOf("Smoke Test candidate UI")).toBeGreaterThan(
      indexOf("Smoke Test candidate HTTP"),
    );
    expect(indexOf("Assign stable Test alias")).toBeGreaterThan(indexOf("Smoke Test candidate UI"));
    expect(indexOf("Verify stable Test URL")).toBeGreaterThan(indexOf("Assign stable Test alias"));
    expect(deployStep?.run).toContain("--target=preview");
    expect(deployStep?.run).toContain('--scope "$VERCEL_SCOPE"');
    expect(deployStep?.run).toContain("--build-env CONVEX_DEPLOY_KEY=");
    expect(deployStep?.run).not.toContain("--build-env VERCEL_ENV=");
    expect(deployStep?.run).toContain("--build-env VERCEL_TARGET_ENV=test");
    expect(deployStep?.run).toContain("--build-env CLAWHUB_SKILLS_SH_ROLLOUT_MODE=test");
    expect(deployStep?.run).toContain("--build-env CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE=test");
    expect(deployStep?.run).toContain("--env CLAWHUB_SKILLS_SH_ROLLOUT_MODE=test");
    expect(deployStep?.run).toContain("--env CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE=test");
    expect(aliasStep?.run).toContain("vercel@50.44.0 alias set");
    expect(aliasStep?.run).toContain('"$DEPLOYMENT_URL"');
    expect(aliasStep?.run).not.toContain("${{ steps.vercel.outputs.deployment_url }}");
    expect(aliasStep?.run).toContain('--scope "$VERCEL_SCOPE"');
  });

  it("activates and reads back both rollout modes only in permanent Test", async () => {
    const workflow = await readWorkflow();
    const steps = workflow.jobs?.["deploy-test"]?.steps ?? [];
    const enable = steps.find((step) => step.name === "Enable Test rollout modes");
    const verify = steps.find((step) => step.name === "Verify Test rollout capabilities");

    expect(enable?.run).toContain("CLAWHUB_SKILLS_SH_ROLLOUT_MODE test");
    expect(enable?.run).toContain("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE test");
    expect(verify?.run).toContain("rolloutCapabilities:getPublicCapabilities");
    expect(verify?.run).toContain('.environment == "test"');
    expect(verify?.run).toContain(".skillsSh.runtimeEnabled == true");
    expect(verify?.run).toContain(".githubSkillSync.selfServiceEnabled == true");
  });

  it("proves both immutable controlled mirror entries before cleanup", async () => {
    const workflow = await readWorkflow();
    const step = workflow.jobs?.["claw563-mirror-load"]?.steps?.find(
      (candidate) =>
        candidate.name === "Load and prove the authenticated leaderboard mirror foundation",
    );
    const run = step?.run ?? "";

    expect(run).toContain('"externalId":"patrick-erichsen/skills/html"');
    expect(run).toContain('"externalId":"steipete/clawdis/discrawl"');
    expect(run).toContain("050daba89f6b6636470add5cb300aac46a412cf8");
    expect(run).toContain("690ed564419291ca6e832dc69b53061300075b62");
    expect(run).toContain("claw563-discrawl-entry.json");
  });
});
