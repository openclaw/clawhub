import { spawnSync } from "node:child_process";
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
  with?: Record<string, number | string>;
};

type WorkflowJob = {
  environment?: { name: string; url: string };
  if?: string;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
};

async function readStagingWorkflow() {
  return parseYaml(await readFile(".github/workflows/deploy-staging.yml", "utf8")) as {
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: Record<string, WorkflowJob>;
    on: {
      push: { branches: string[] };
      workflow_dispatch: {
        inputs: Record<string, { required: boolean; type: string }>;
      };
    };
    permissions: Record<string, string>;
  };
}

function namedStep(job: WorkflowJob, name: string) {
  const step = job.steps.find((candidate) => candidate.name === name);
  expect(step, `${name} step exists`).toBeDefined();
  return step!;
}

describe("Staging deploy workflow", () => {
  it("waits for successful exact-SHA staging push CI before deploying", async () => {
    const ci = parseYaml(await readFile(".github/workflows/ci.yml", "utf8")) as {
      on: { push: { branches: string[] } };
    };
    const workflow = await readStagingWorkflow();
    const deploy = workflow.jobs["deploy-staging"]!;
    const revision = namedStep(deploy, "Resolve staging revision");
    const wait = namedStep(deploy, "Wait for successful staging CI");

    expect(ci.on.push.branches).toEqual(["main", "staging"]);
    expect(workflow.on.push.branches).toEqual(["staging"]);
    expect(workflow.on.workflow_dispatch.inputs.expected_sha).toEqual(
      expect.objectContaining({ required: true, type: "string" }),
    );
    expect(workflow.concurrency).toEqual({
      group: "deploy-staging",
      "cancel-in-progress": false,
    });
    expect(workflow.permissions).toEqual({});
    expect(deploy.if).toContain("github.event_name == 'push'");
    expect(deploy.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(deploy.if).toContain("github.ref == 'refs/heads/staging'");
    expect(deploy.if).toContain("inputs.expected_sha != ''");
    expect(deploy.environment?.name).toBe("Staging");
    expect(deploy.permissions).toEqual({
      actions: "read",
      contents: "read",
      deployments: "read",
      statuses: "read",
    });
    expect(deploy.steps[0]?.with).toEqual({ "fetch-depth": 0, ref: "${{ github.sha }}" });
    expect(revision.env?.EXPECTED_SHA).toBe(
      "${{ github.event_name == 'push' && github.sha || inputs.expected_sha }}",
    );
    expect(revision.run).toContain('"$EXPECTED_SHA" != "$deploy_sha"');
    expect(revision.run).toContain('"$deploy_sha" != "$current_sha"');
    expect(revision.run).toContain("git merge-base --is-ancestor");
    expect(wait.run).toContain("actions/workflows/ci.yml/runs");
    expect(wait.run).toContain('-f branch=staging -f event=push -f head_sha="$DEPLOY_SHA"');
    expect(wait.run).toContain(".head_sha == $sha");
    expect(wait.run).toContain('"$ci_status" == completed');
    expect(wait.run).toContain('"$ci_conclusion" == success');
    expect(deploy.steps.indexOf(wait)).toBeLessThan(
      deploy.steps.indexOf(namedStep(deploy, "Recheck staging head after CI")),
    );
    expect(deploy.steps.indexOf(wait)).toBeLessThan(
      deploy.steps.indexOf(namedStep(deploy, "Check Staging configuration")),
    );
  });

  it("pins the staging backend and hook project while excluding preview seeding", async () => {
    const workflow = await readStagingWorkflow();
    const deploy = workflow.jobs["deploy-staging"]!;
    const revision = namedStep(deploy, "Resolve staging revision");
    const config = namedStep(deploy, "Check Staging configuration");
    const plan = namedStep(deploy, "Verify staging frontend build plan");
    const auth = namedStep(deploy, "Check Staging backend auth configuration");
    const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8")) as {
      buildCommand: string;
      git?: { deploymentEnabled?: Record<string, boolean> };
      rewrites?: unknown[];
    };

    expect(vercelConfig.buildCommand).toBe("bun run build:vercel");
    expect(vercelConfig.git?.deploymentEnabled).toEqual({ staging: false });
    expect(vercelConfig.rewrites).toBeUndefined();
    expect(revision.run).toContain(".git.deploymentEnabled.staging == false");
    expect(revision.run).toContain('.buildCommand == "bun run build:vercel"');
    expect(revision.run).toContain("((.rewrites // []) | length == 0)");
    expect(config.env?.CONVEX_DEPLOY_KEY).toBe("${{ secrets.CONVEX_DEPLOY_KEY }}");
    expect(config.env?.VERCEL_AUTOMATION_BYPASS_SECRET).toBe(
      "${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
    expect(config.env?.VERCEL_DEPLOY_HOOK_URL).toBe("${{ secrets.VERCEL_DEPLOY_HOOK_URL }}");
    expect(config.run).toContain("prod:cheery-civet-733\\|*");
    expect(config.run).toContain("openclaw-foundation");
    expect(config.run).toContain("prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc");
    expect(config.run).toContain(
      "https://api.vercel.com/v1/integrations/deploy/$VERCEL_PROJECT_ID/",
    );
    expect(config.run).toContain("https://cheery-civet-733.convex.cloud");
    expect(config.run).toContain("https://cheery-civet-733.convex.site");
    expect(plan.run).toContain('CLAWHUB_ENV: "staging"');
    expect(plan.run).toContain('CLAWHUB_STAGING_EDGE_SECRET: "build-plan-fixture"');
    expect(plan.run).toContain('VERCEL_TARGET_ENV: "preview"');
    expect(plan.run).toContain('VERCEL_GIT_COMMIT_REF: "staging"');
    expect(plan.env?.STAGING_SITE_URL).toContain("clawhub-git-staging");
    expect(plan.run).toContain("SITE_URL: process.env.STAGING_SITE_URL");
    expect(plan.run).toContain("VITE_SITE_URL: process.env.STAGING_SITE_URL");
    expect(plan.run).toContain("resolveVercelBuildPlan(env)");
    expect(plan.run).toContain("resolveFrontendBuildEnv(env)");
    expect(plan.run).toContain('.frontend.VITE_CLAWHUB_DEPLOY_ENV == "staging"');
    expect(plan.run).toContain(".frontend.SITE_URL == $site");
    expect(plan.run).toContain(".frontend.VITE_SITE_URL == $site");
    expect(auth.run).toContain("convex env list --names-only --prod");
    for (const name of [
      "AUTH_GITHUB_ID",
      "AUTH_GITHUB_SECRET",
      "JWT_PRIVATE_KEY",
      "JWKS",
      "CLAWHUB_STAGING_EDGE_SECRET",
    ]) {
      expect(auth.run).toContain(name);
    }
    expect(JSON.stringify(workflow)).not.toContain("VERCEL_TOKEN");
    expect(JSON.stringify(workflow)).not.toContain("seed:test");
    expect(JSON.stringify(workflow)).not.toContain("--preview-create");
  });

  it("fails the shell configuration guard for a production key, URL, or wrong hook project", async () => {
    const workflow = await readStagingWorkflow();
    const script = namedStep(workflow.jobs["deploy-staging"]!, "Check Staging configuration").run!;
    const configured = {
      CONVEX_DEPLOY_KEY: "prod:cheery-civet-733|test-only",
      STAGING_SITE_URL: "https://clawhub-git-staging-openclaw-foundation.vercel.app",
      VERCEL_AUTOMATION_BYPASS_SECRET: "test-only",
      VERCEL_DEPLOY_HOOK_URL:
        "https://api.vercel.com/v1/integrations/deploy/prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc/test-only",
      VERCEL_PROJECT_ID: "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc",
      VERCEL_SCOPE: "openclaw-foundation",
      VITE_CONVEX_SITE_URL: "https://cheery-civet-733.convex.site",
      VITE_CONVEX_URL: "https://cheery-civet-733.convex.cloud",
    };
    const run = (changes: Partial<typeof configured>) =>
      spawnSync("bash", ["-e"], {
        input: script,
        encoding: "utf8",
        env: { ...process.env, ...configured, ...changes },
      });

    expect(run({}).status).toBe(0);
    expect(run({ CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|test-only" }).status).not.toBe(0);
    expect(run({ STAGING_SITE_URL: "https://clawhub.ai" }).status).not.toBe(0);
    expect(run({ STAGING_SITE_URL: "https://clawhub.com" }).status).not.toBe(0);
    expect(run({ STAGING_SITE_URL: "https://evil.example" }).status).not.toBe(0);
    expect(run({ STAGING_SITE_URL: "https://stg.clawhub.ai" }).status).toBe(0);
    expect(run({ STAGING_SITE_URL: "https://stg.clawhub.openclaw.org" }).status).toBe(0);
    expect(run({ VERCEL_AUTOMATION_BYPASS_SECRET: "" }).status).not.toBe(0);
    expect(run({ VITE_CONVEX_SITE_URL: "https://wry-manatee-359.convex.site" }).status).not.toBe(0);
    expect(
      run({
        VERCEL_DEPLOY_HOOK_URL:
          "https://api.vercel.com/v1/integrations/deploy/prj_production/test-only",
      }).status,
    ).not.toBe(0);
    expect(
      run({
        VERCEL_PROJECT_ID: "prj_production",
        VERCEL_DEPLOY_HOOK_URL:
          "https://api.vercel.com/v1/integrations/deploy/prj_production/test-only",
      }).status,
    ).not.toBe(0);
  });

  it("accepts only a successful staging push CI run for the selected SHA", async () => {
    const workflow = await readStagingWorkflow();
    const script = namedStep(
      workflow.jobs["deploy-staging"]!,
      "Wait for successful staging CI",
    ).run!;
    const selectedSha = "a".repeat(40);
    const execute = (runSha: string, conclusion: string) =>
      spawnSync("bash", ["-e"], {
        input: `
          gh() {
            [[ "$*" == *"actions/workflows/ci.yml/runs"* ]] || return 91
            [[ "$*" == *"head_sha=$DEPLOY_SHA"* ]] || return 92
            printf '%s' "$STUB_CI_RUNS"
          }
          sleep() { return 93; }
          ${script}
        `,
        encoding: "utf8",
        env: {
          ...process.env,
          DEPLOY_SHA: selectedSha,
          GITHUB_REPOSITORY: "openclaw/clawhub",
          STUB_CI_RUNS: JSON.stringify({
            workflow_runs: [
              {
                event: "push",
                head_branch: "staging",
                head_sha: runSha,
                run_number: 1,
                status: "completed",
                conclusion,
                html_url: "https://github.com/openclaw/clawhub/actions/runs/1",
              },
            ],
          }),
        },
      });

    expect(execute(selectedSha, "success").status).toBe(0);
    expect(execute("b".repeat(40), "success").status).not.toBe(0);
    expect(execute(selectedSha, "failure").status).not.toBe(0);
  });

  it("rejects an already deployed SHA on rerun or dispatch before changing Convex", async () => {
    const workflow = await readStagingWorkflow();
    const deploy = workflow.jobs["deploy-staging"]!;
    const guard = namedStep(deploy, "Reject previously deployed staging SHA");
    const index = (name: string) => deploy.steps.findIndex((step) => step.name === name);
    const selectedSha = "a".repeat(40);
    const existing = {
      id: 42,
      sha: selectedSha,
      creator: { login: "vercel[bot]" },
      environment: "Preview – clawhub",
    };
    const execute = (pages: unknown[][]) =>
      spawnSync("bash", ["-e"], {
        input: `
          gh() {
            [[ "$*" == *"repos/$GITHUB_REPOSITORY/deployments"* ]] || return 91
            [[ "$*" == *"sha=$DEPLOY_SHA"* ]] || return 92
            [[ "$*" == *"--paginate"* ]] || return 93
            printf '%s' "$STUB_DEPLOYMENTS"
          }
          ${guard.run}
        `,
        encoding: "utf8",
        env: {
          ...process.env,
          DEPLOY_SHA: selectedSha,
          GITHUB_REPOSITORY: "openclaw/clawhub",
          STUB_DEPLOYMENTS: JSON.stringify(pages),
        },
      });

    expect(guard.if).toBe(
      "fromJSON(github.run_attempt) > 1 || github.event_name == 'workflow_dispatch'",
    );
    expect(guard.env?.GH_TOKEN).toBe("${{ github.token }}");
    expect(index("Recheck staging head after CI")).toBeLessThan(
      index("Reject previously deployed staging SHA"),
    );
    expect(index("Reject previously deployed staging SHA")).toBeLessThan(
      index("Configure Staging backend"),
    );
    expect(execute([[]]).status).toBe(0);
    expect(
      execute([
        [
          { ...existing, sha: "b".repeat(40) },
          { ...existing, creator: { login: "other-bot" } },
          { ...existing, environment: "Production – clawhub" },
        ],
      ]).status,
    ).toBe(0);
    const rejected = execute([[{ ...existing, sha: "b".repeat(40) }], [existing]]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout).toContain("Push a new commit for environment-only changes");
  });

  it("deploys Convex before stamping the verified SHA and triggering the hook", async () => {
    const workflow = await readStagingWorkflow();
    const deploy = workflow.jobs["deploy-staging"]!;
    const index = (name: string) => deploy.steps.findIndex((step) => step.name === name);
    const configure = namedStep(deploy, "Configure Staging backend");
    const stamp = namedStep(deploy, "Stamp verified Staging SHA");
    const verify = namedStep(deploy, "Verify Staging backend identity");

    expect(index("Check Staging configuration")).toBeLessThan(index("Configure Staging backend"));
    expect(index("Check Staging backend auth configuration")).toBeLessThan(
      index("Configure Staging backend"),
    );
    expect(index("Configure Staging backend")).toBeLessThan(index("Deploy Convex Staging"));
    expect(index("Deploy Convex Staging")).toBeLessThan(index("Verify Convex contract"));
    expect(index("Verify Convex contract")).toBeLessThan(index("Stamp verified Staging SHA"));
    expect(index("Stamp verified Staging SHA")).toBeLessThan(
      index("Verify Staging backend identity"),
    );
    expect(index("Verify Staging backend identity")).toBeLessThan(
      index("Recheck staging head before Deploy Hook"),
    );
    expect(index("Recheck staging head before Deploy Hook")).toBeLessThan(
      index("Trigger staging Vercel Deploy Hook"),
    );
    expect(configure.run).toContain("convex env set CLAWHUB_ENV staging --prod");
    expect(configure.run).toContain("convex env set CLAWHUB_DISABLE_CRONS 1 --prod");
    expect(configure.run).toContain("convex env set CLAWHUB_SKILLS_SH_ROLLOUT_MODE off --prod");
    expect(configure.run).toContain(
      "convex env set CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE off --prod",
    );
    expect(configure.run).not.toContain("APP_BUILD_SHA");
    expect(stamp.run).toContain('convex env set APP_BUILD_SHA "$DEPLOY_SHA" --prod');
    expect(verify.run).toContain("appMeta:getDeploymentInfo --prod");
    expect(verify.run).toContain(".appBuildSha == $sha");
    expect(verify.run).toContain('.environment == "staging"');
  });

  it("proves a new Vercel deployment at the exact SHA before checking the stable URL", async () => {
    const workflow = await readStagingWorkflow();
    const deploy = workflow.jobs["deploy-staging"]!;
    const index = (name: string) => deploy.steps.findIndex((step) => step.name === name);
    const hook = namedStep(deploy, "Trigger staging Vercel Deploy Hook");
    const wait = namedStep(deploy, "Wait for exact-SHA Vercel Preview");
    const candidate = namedStep(deploy, "Smoke Staging candidate API");
    const stable = namedStep(deploy, "Verify stable Staging URL");

    expect(hook.env?.VERCEL_DEPLOY_HOOK_URL).toBe("${{ secrets.VERCEL_DEPLOY_HOOK_URL }}");
    expect(hook.run).toContain("fetch(hook, { method: 'POST' })");
    expect(hook.run).toContain("started_at=${startedAt}");
    expect(wait.env?.DEPLOY_SHA).toBe("${{ steps.revision.outputs.deploy_sha }}");
    expect(wait.env?.HOOK_STARTED_AT).toBe("${{ steps.hook.outputs.started_at }}");
    expect(wait.env?.VERCEL_STATUS_CONTEXT).toBe("Vercel – clawhub");
    expect(wait.run).toContain(".created_at >= $started");
    expect(wait.run).toContain(".sha == $sha");
    expect(wait.run).toContain('.environment == "Preview – clawhub"');
    expect(wait.run).toContain("https://vercel.com/openclaw-foundation/clawhub/");
    expect(wait.run).toContain("environment_url");
    expect(wait.run).toContain(
      '"$deployment_url" == https://clawhub-git-staging-openclaw-foundation.vercel.app',
    );
    expect(index("Wait for exact-SHA Vercel Preview")).toBeLessThan(
      index("Smoke Staging candidate API"),
    );
    expect(index("Smoke Staging candidate API")).toBeLessThan(index("Smoke Staging candidate UI"));
    expect(index("Smoke Staging candidate UI")).toBeLessThan(index("Verify stable Staging URL"));
    expect(candidate.env?.CLAWHUB_E2E_SITE).toBe("${{ steps.vercel.outputs.deployment_url }}");
    expect(stable.env?.CLAWHUB_E2E_SITE).toContain("clawhub-git-staging");
    expect(stable.run).toContain("for attempt in {1..30}");
    for (const smoke of [candidate, stable]) {
      expect(smoke.env?.CLAWHUB_E2E_EXPECT_STAGING_BACKEND).toBe("cheery-civet-733");
      expect(smoke.env?.CLAWHUB_E2E_EXPECT_STAGING_SHA).toBe(
        "${{ steps.revision.outputs.deploy_sha }}",
      );
      expect(smoke.run).toContain("e2e/staging-api.e2e.test.ts");
    }
  });
});
