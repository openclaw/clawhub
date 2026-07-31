import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("production deploy workflow", () => {
  type WorkflowStep = {
    name?: string;
    env?: Record<string, string>;
    if?: string;
    run?: string;
  };

  type WorkflowJob = {
    env?: Record<string, string>;
    needs?: string | string[];
    permissions?: Record<string, string>;
    steps?: WorkflowStep[];
  };

  type DeployWorkflow = {
    jobs?: Record<string, WorkflowJob>;
    on?: {
      workflow_dispatch?: {
        inputs?: Record<
          string,
          {
            default?: string;
            description?: string;
            required?: boolean;
            type?: string;
          }
        >;
      };
    };
    permissions?: Record<string, string>;
  };

  it("queues active deploys instead of cancelling them", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8")) as {
      concurrency?: {
        group?: string;
        "cancel-in-progress"?: boolean;
      };
    };

    expect(workflow.concurrency).toEqual({
      group: "deploy-production",
      "cancel-in-progress": false,
    });
  });

  it("scopes production secrets and write permissions to the steps that need them", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8")) as {
      permissions?: Record<string, string>;
      jobs?: Record<string, WorkflowJob>;
    };
    const deployJob = workflow.jobs?.["deploy-production"];
    const tagJob = workflow.jobs?.["tag-production-deployment"];
    const convexSecretSteps =
      deployJob?.steps?.filter((step) => step.env?.CONVEX_DEPLOY_KEY).map((step) => step.name) ??
      [];
    const authSecretSteps =
      deployJob?.steps
        ?.filter((step) => step.env?.PLAYWRIGHT_AUTH_STORAGE_STATE_JSON)
        .map((step) => step.name) ?? [];

    expect(workflow.permissions).toEqual({});
    expect(deployJob?.permissions).toEqual({ contents: "read", statuses: "read" });
    expect(deployJob?.env).toEqual({ PLAYWRIGHT_BASE_URL: "https://clawhub.ai" });
    expect(convexSecretSteps).toEqual([
      "Check deploy configuration",
      "Inspect external skill rollout modes",
      "Pause external skill rollouts",
      "Stamp Convex runtime environment",
      "Stamp Convex build SHA",
      "Stamp Convex deploy time",
      "Deploy Convex",
      "Publish promotions feed snapshot",
      "Verify Convex contract",
      "Verify dark rollout capabilities",
      "Restore external skill rollouts",
      "Verify restored external skill rollouts",
    ]);
    expect(authSecretSteps).toEqual(["Write authenticated storage state"]);
    expect(tagJob?.permissions).toEqual({ contents: "write" });
    expect(tagJob?.needs).toEqual(["validate-deploy-request", "deploy-production"]);
  });

  it("fails closed on active rollouts unless a backend deploy explicitly pauses and restores them", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/deploy.yml", "utf8"),
    ) as DeployWorkflow;
    const steps = workflow.jobs?.["deploy-production"]?.steps ?? [];
    const validateSteps = workflow.jobs?.["validate-deploy-request"]?.steps ?? [];
    const resolveMode = validateSteps.find((step) => step.name === "Resolve deploy mode");
    const inspect = steps.find((step) => step.name === "Inspect external skill rollout modes");
    const pause = steps.find((step) => step.name === "Pause external skill rollouts");
    const verifyDark = steps.find((step) => step.name === "Verify dark rollout capabilities");
    const restore = steps.find((step) => step.name === "Restore external skill rollouts");
    const verifyRestored = steps.find(
      (step) => step.name === "Verify restored external skill rollouts",
    );
    const input = workflow.on?.workflow_dispatch?.inputs?.active_rollout_deploy_confirm;

    expect(input).toMatchObject({
      required: false,
      default: "",
      type: "string",
    });
    expect(input?.description).toContain("pause-and-restore-active-rollouts");
    expect(resolveMode?.run).toContain('"$target" != "backend"');
    expect(resolveMode?.env?.ACTIVE_ROLLOUT_DEPLOY_CONFIRM).toBe(
      "${{ inputs.active_rollout_deploy_confirm }}",
    );
    expect(resolveMode?.run).not.toContain("${{ inputs.active_rollout_deploy_confirm }}");
    expect(inspect?.run).toContain("convex env list --names-only --prod");
    expect(inspect?.run).toContain("CLAWHUB_SKILLS_SH_ROLLOUT_MODE");
    expect(inspect?.run).toContain("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE");
    expect(inspect?.run).toContain("test|production");
    expect(inspect?.run).toContain("pause-and-restore-active-rollouts");
    expect(inspect?.env?.ACTIVE_ROLLOUT_DEPLOY_CONFIRM).toBe(
      "${{ inputs.active_rollout_deploy_confirm }}",
    );
    expect(inspect?.run).not.toContain("${{ inputs.active_rollout_deploy_confirm }}");
    expect(pause?.if).toBe("steps.rollout.outputs.pause_required == 'true'");
    expect(pause?.run).toContain("convex env set CLAWHUB_SKILLS_SH_ROLLOUT_MODE off --prod");
    expect(pause?.run).toContain(
      "convex env set CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE off --prod",
    );
    expect(verifyDark?.run).toContain("rolloutCapabilities:getPublicCapabilities");
    expect(verifyDark?.run).toContain('.environment == "production"');
    expect(verifyDark?.run).toContain(".skillsSh.runtimeEnabled == false");
    expect(verifyDark?.run).toContain(".githubSkillSync.selfServiceEnabled == false");
    expect(restore?.if).toContain("always()");
    expect(restore?.run).toContain(
      'convex env set CLAWHUB_SKILLS_SH_ROLLOUT_MODE "$SKILLS_SH_RESTORE_MODE" --prod',
    );
    expect(restore?.run).toContain(
      'convex env set CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE "$GITHUB_SKILL_SYNC_RESTORE_MODE" --prod',
    );
    expect(verifyRestored?.if).toContain("always()");
    expect(verifyRestored?.run).toContain(".skillsSh.mode == $skills_sh_mode");
    expect(verifyRestored?.run).toContain(".githubSkillSync.mode == $github_skill_sync_mode");

    const pauseIndex = steps.indexOf(pause!);
    const deployIndex = steps.findIndex((step) => step.name === "Deploy Convex");
    const verifyDarkIndex = steps.indexOf(verifyDark!);
    const restoreIndex = steps.indexOf(restore!);
    const verifyRestoredIndex = steps.indexOf(verifyRestored!);
    const smokeIndex = steps.findIndex((step) => step.name === "Smoke test production HTTP");
    expect(pauseIndex).toBeLessThan(deployIndex);
    expect(deployIndex).toBeLessThan(verifyDarkIndex);
    expect(verifyDarkIndex).toBeLessThan(restoreIndex);
    expect(restoreIndex).toBeLessThan(verifyRestoredIndex);
    expect(verifyRestoredIndex).toBeLessThan(smokeIndex);
  });

  it("stamps the production runtime identity before deploying Convex", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8")) as {
      jobs?: Record<string, WorkflowJob>;
    };
    const steps = workflow.jobs?.["deploy-production"]?.steps ?? [];
    const stampIndex = steps.findIndex((step) => step.name === "Stamp Convex runtime environment");
    const deployIndex = steps.findIndex((step) => step.name === "Deploy Convex");
    const stamp = steps[stampIndex];

    expect(stampIndex).toBeGreaterThanOrEqual(0);
    expect(stampIndex).toBeLessThan(deployIndex);
    expect(stamp?.run).toBe("bunx convex env set CLAWHUB_ENV production --prod");
  });

  it("publishes the initial promotions snapshot after backend deploy", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8")) as {
      jobs?: Record<string, WorkflowJob>;
    };
    const steps = workflow.jobs?.["deploy-production"]?.steps ?? [];
    const deployIndex = steps.findIndex((step) => step.name === "Deploy Convex");
    const publishIndex = steps.findIndex(
      (step) => step.name === "Publish promotions feed snapshot",
    );
    const verifyIndex = steps.findIndex((step) => step.name === "Verify Convex contract");
    const publishStep = steps[publishIndex];

    expect(deployIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(deployIndex);
    expect(verifyIndex).toBeGreaterThan(publishIndex);
    expect(publishStep?.if).toBe("needs.validate-deploy-request.outputs.deploy_backend == 'true'");
    expect(publishStep?.run).toBe("bunx convex run promotionsFeed:publishInternal --prod");
  });
});
