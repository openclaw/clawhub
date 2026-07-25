import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, string>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
};

type WorkflowJob = {
  environment?: { name?: string; url?: string };
  if?: string;
  needs?: string;
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
  it("admits main CI and exact guarded mirror proof branches", async () => {
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
      types: ["synchronize", "labeled"],
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
    expect(job?.if).toContain("github.ref == 'refs/heads/pe/claw-589-trending-rank-overlay'");
    expect(job?.if).toContain("inputs.branch_test_confirm == 'deploy-claw-589-to-permanent-test'");
    expect(job?.if).toContain("github.ref == 'refs/heads/pe/claw-577-canonical-mixed-search'");
    expect(job?.if).toContain("inputs.branch_test_confirm == 'deploy-claw-577-to-permanent-test'");
    expect(job?.if).toContain("github.ref == 'refs/heads/pe/claw-583-mirrored-search-journey'");
    expect(job?.if).toContain("inputs.branch_test_confirm == 'deploy-claw-583-to-permanent-test'");
    expect(job?.if).toContain("inputs.expected_sha != ''");
    expect(job?.if).toContain("github.event_name == 'pull_request'");
    expect(job?.if).toContain(
      "github.event.pull_request.head.ref == 'pe/claw-563-skills-sh-mirror-10k'",
    );
    expect(job?.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(job?.if).toContain("github.actor == 'Patrick-Erichsen'");
    expect(job?.if).toContain(
      "contains(github.event.pull_request.labels.*.name, 'test-mirror-load')",
    );
    expect(job?.if).toContain(
      "github.event.pull_request.head.ref == 'pe/claw-589-trending-rank-overlay'",
    );
    expect(job?.if).toContain(
      "contains(github.event.pull_request.labels.*.name, 'test-trending-load')",
    );
    expect(job?.if).toContain(
      "github.event.pull_request.head.ref == 'pe/claw-577-canonical-mixed-search'",
    );
    expect(job?.if).toContain(
      "contains(github.event.pull_request.labels.*.name, 'test-search-load')",
    );
    expect(job?.if).toContain(
      "github.event.pull_request.head.ref == 'pe/claw-583-mirrored-search-journey'",
    );
    expect(job?.if).toContain(
      "contains(github.event.pull_request.labels.*.name, 'test-external-catalog')",
    );
    expect(job?.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(job?.if).toContain("github.event.workflow_run.event == 'push'");
    expect(revision).toContain('deploy_sha" != "$main_sha');
    expect(revision).toContain("refs/heads/pe/claw-563-skills-sh-mirror-10k");
    expect(revision).toContain("Patrick-Erichsen");
    expect(revision).toContain("deploy-claw-563-to-permanent-test");
    expect(revision).toContain("refs/heads/pe/claw-589-trending-rank-overlay");
    expect(revision).toContain("deploy-claw-589-to-permanent-test");
    expect(revision).toContain("refs/heads/pe/claw-577-canonical-mixed-search");
    expect(revision).toContain("deploy-claw-577-to-permanent-test");
    expect(revision).toContain("refs/heads/pe/claw-583-mirrored-search-journey");
    expect(revision).toContain("deploy-claw-583-to-permanent-test");
    expect(revision).toContain("${{ inputs.expected_sha }}");
    expect(revision).toContain("${{ github.event.pull_request.head.sha }}");
    expect(revision).toContain("${{ github.event.pull_request.head.repo.full_name }}");
    expect(revision).toContain("$GITHUB_REPOSITORY");
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
    expect(deployStep?.run).toContain("--env VERCEL_TARGET_ENV=test");
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

  it("runs the CLAW-589 proof only for its exact branch and label", async () => {
    const workflow = await readWorkflow();
    const job = workflow.jobs?.["claw589-trending-load"];
    const step = job?.steps?.find(
      (candidate) =>
        candidate.name === "Observe and prove the authenticated skills.sh Trending overlay",
    );
    const run = step?.run ?? "";

    expect(job?.if).toContain(
      "github.event.pull_request.head.ref == 'pe/claw-589-trending-rank-overlay'",
    );
    expect(job?.if).toContain("test-trending-load");
    expect(job?.environment?.name).toBe("Test");
    expect(run).toContain("bun run skills-sh:prove-trending");
    expect(run).toContain("appMeta:getDeploymentInfo");
    expect(run).toContain("CLAW-589 fail-closed cleanup");
    expect(run).toContain("proof/claw-589/active-run.json");
    expect(run).toContain(".runId == $ownedRun");
    expect(run).toContain("trending24hInstalls == null");
    expect(run).toContain("revokedStatus");
  });

  it("runs the CLAW-577 search proof only for its exact guarded branch", async () => {
    const workflow = await readWorkflow();
    const job = workflow.jobs?.["claw577-search-proof"];
    const proofStep = job?.steps?.find(
      (candidate) => candidate.name === "Prove canonical search order and cost in permanent Test",
    );
    const upload = job?.steps?.find(
      (candidate) => candidate.name === "Upload permanent Test canonical search proof",
    );
    const run = proofStep?.run ?? "";

    expect(job?.needs).toBe("deploy-test");
    expect(job?.if).toContain(
      "github.event.pull_request.head.ref == 'pe/claw-577-canonical-mixed-search'",
    );
    expect(job?.if).toContain("test-search-load");
    expect(job?.if).toContain("inputs.branch_test_confirm == 'deploy-claw-577-to-permanent-test'");
    expect(job?.environment?.name).toBe("Test");
    expect(job?.steps?.[0]?.with?.ref).toContain("github.event.pull_request.head.sha");
    expect(proofStep?.env?.DEPLOY_SHA).toBe("${{ needs.deploy-test.outputs.deploy_sha }}");
    expect(run).toContain("appMeta:getDeploymentInfo");
    expect(run).toContain("searchTestFixtures:seedCanonicalSearchTestFixture");
    expect(run).toContain("bun run search:prove-test");
    expect(run).toContain("trap cleanup EXIT");
    expect(run).toContain("searchTestFixtures:cleanupCanonicalSearchTestFixture");
    expect(run).toContain("searchTestFixtures:readCanonicalSearchTestFixture");
    expect(run).toContain("claw577-cleanup-recovery.json");
    expect(upload?.uses).toBe("actions/upload-artifact@v7");
    expect(upload?.with?.name).toBe("claw577-search-proof");
    expect(upload?.with?.["if-no-files-found"]).toBe("error");
    expect(upload?.with?.path).toContain("proof/claw-577/canonical-search-test-proof.json");
    expect(upload?.with?.path).toContain("claw577-cleanup.json");
  });

  it("runs the CLAW-583 external catalog proof only for its exact guarded branch", async () => {
    const workflow = await readWorkflow();
    const job = workflow.jobs?.["claw583-external-catalog-proof"];
    const proofStep = job?.steps?.find(
      (candidate) =>
        candidate.name ===
        "Prove external search, detail, install, verify, and cleanup in permanent Test",
    );
    const upload = job?.steps?.find(
      (candidate) => candidate.name === "Upload permanent Test external catalog proof",
    );
    const run = proofStep?.run ?? "";

    expect(job?.needs).toBe("deploy-test");
    expect(job?.if).toContain(
      "github.event.pull_request.head.ref == 'pe/claw-583-mirrored-search-journey'",
    );
    expect(job?.if).toContain("test-external-catalog");
    expect(job?.if).toContain("inputs.branch_test_confirm == 'deploy-claw-583-to-permanent-test'");
    expect(job?.environment?.name).toBe("Test");
    expect(job?.steps?.[0]?.with?.ref).toContain("github.event.pull_request.head.sha");
    expect(proofStep?.env?.DEPLOY_SHA).toBe("${{ needs.deploy-test.outputs.deploy_sha }}");
    expect(run).toContain("skillsShPublicTestFixtures:activateControlledExternalSkill");
    expect(run).toContain("skillsShPublicTestFixtures:deactivateControlledExternalSkill");
    expect(run).toContain("search:searchSkills");
    expect(run).toContain("skills-sh%3Apatrick-erichsen%2Fskills%2Fhtml");
    expect(run).toContain("Not scanned by ClawHub");
    expect(run).toContain("trap cleanup EXIT");
    expect(run).toContain("e2e/skills-sh-external.pw.test.ts");
    expect(upload?.uses).toBe("actions/upload-artifact@v7");
    expect(upload?.with?.name).toBe("claw583-external-catalog-proof");
    expect(upload?.with?.["if-no-files-found"]).toBe("error");
    expect(upload?.with?.path).toContain("proof/claw-583/external-flow.webm");
    expect(upload?.with?.path).toContain("proof/claw-583/external-detail.png");
    expect(upload?.with?.path).toContain("claw583-cleanup-readback.json");
  });
});
