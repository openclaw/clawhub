import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { redactWorkerPublicText } from "../lib/workerRedaction";

const exec = promisify(execFile);
const DEPLOY_LIMIT_MS = 45 * 60_000;
const PROGRESS_WAIT_MS = 30 * 60_000;
const POLL_MS = 10_000;
const receiptPath = "skills-sh-deploy-overlap-proof.json";
const EXPERIMENT_NAME = "2026-10-05 single skills.sh deployment overlap experiment";
const logPath = "skills-sh-deploy-overlap.log";
const observations: Record<string, unknown>[] = [];
const receipt: Record<string, unknown> = { ok: false, observations };
let deployDeadline: number | undefined;

function redact(text: string) {
  const key = process.env.CONVEX_DEPLOY_KEY;
  const withoutKey = key ? text.split(key).join("[redacted]") : text;
  return redactWorkerPublicText(withoutKey, withoutKey.length);
}

async function command(args: string[]) {
  const remaining = deployDeadline ? deployDeadline - Date.now() : 60_000;
  if (remaining <= 0) throw new Error("The normal 45-minute deployment phase limit expired");
  await appendFile(logPath, `${new Date().toISOString()} start: bun ${args.join(" ")}\n`);
  try {
    const result = await exec("bun", args, { timeout: remaining, maxBuffer: 64 * 1024 * 1024 });
    await appendFile(logPath, redact(result.stdout + result.stderr));
    await appendFile(logPath, `${new Date().toISOString()} complete: bun ${args.join(" ")}\n`);
    return result.stdout;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    await appendFile(logPath, redact(`${failure.stdout ?? ""}${failure.stderr ?? ""}`));
    throw new Error(redact(failure.message ?? String(error)));
  }
}

async function query(path: string) {
  return JSON.parse(await command(["x", "convex", "run", path, "--prod"])) as Record<
    string,
    unknown
  >;
}

async function github(path: string) {
  // Public repository reads need no broader workflow-token permissions.
  const response = await fetch(`https://api.github.com/repos/openclaw/clawhub/${path}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Release preflight GitHub read failed: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export function validateExperimentRequest(env: NodeJS.ProcessEnv) {
  if (
    env.GITHUB_REPOSITORY !== "openclaw/clawhub" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_ACTOR !== "Patrick-Erichsen" ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    !/^\d+$/.test(env.GITHUB_RUN_ID ?? "") ||
    env.EXPERIMENT_CONFIRM !== "deploy-once-with-enabled-skills-sh" ||
    !/^[a-f0-9]{40}$/.test(env.EXPERIMENT_SHA ?? "") ||
    env.EXPERIMENT_SHA !== env.GITHUB_SHA ||
    !/^\d+$/.test(env.EXPERIMENT_TEST_RUN ?? "") ||
    !/^\d+$/.test(env.EXPERIMENT_CI_RUN ?? "")
  ) {
    throw new Error(
      "Experiment requires Patrick's first-attempt main dispatch and exact release proof",
    );
  }
  if (!env.CONVEX_DEPLOY_KEY?.startsWith("prod:wry-manatee-359|")) {
    throw new Error("A production deploy key scoped to wry-manatee-359 is required");
  }
}

export function syncEnvironment(env: NodeJS.ProcessEnv) {
  const result = { ...env };
  delete result.CONVEX_DEPLOY_KEY;
  return result;
}

export function syncOwnsActiveControl(control: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  return (
    control.enabled === true &&
    control.paused === false &&
    control.updatedBy === `github-actions:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`
  );
}

export function firstExperimentRun(runs: Array<{ id: number; display_title: string }>) {
  const ids = runs.filter((run) => run.display_title === EXPERIMENT_NAME).map((run) => run.id);
  if (ids.some((id) => !Number.isSafeInteger(id)))
    throw new Error("Invalid immutable run identity");
  return ids.length ? Math.min(...ids) : undefined;
}

export function isUnstartedCancellation(
  run: { status?: string; conclusion?: string | null; run_attempt?: number },
  jobs: { total_count?: number; jobs?: unknown[] },
) {
  return (
    run.status === "completed" &&
    run.conclusion === "cancelled" &&
    run.run_attempt === 1 &&
    jobs.total_count === 0 &&
    Array.isArray(jobs.jobs) &&
    jobs.jobs.length === 0
  );
}

async function requireSingleDispatch() {
  const runs: Array<{
    id: number;
    display_title: string;
    created_at: string;
    status: string;
    conclusion: string | null;
    run_attempt: number;
  }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await github(
      `actions/workflows/skills-sh-sync.yml/runs?event=workflow_dispatch&per_page=100&page=${page}`,
    );
    const batch = result.workflow_runs as typeof runs;
    runs.push(...batch);
    if (batch.length < 100 || batch.at(-1)!.created_at < "2026-10-05T00:00:00Z") {
      const eligible = [];
      const unstarted = [];
      for (const run of runs) {
        if (run.display_title !== EXPERIMENT_NAME) continue;
        if (run.status === "completed" && run.conclusion === "cancelled" && run.run_attempt === 1) {
          const jobs = await github(`actions/runs/${run.id}/jobs?per_page=1`);
          // A replaced pending workflow with zero jobs never reached any production command.
          // Any started job, failed attempt, rerun or unverifiable history consumes the attempt.
          if (isUnstartedCancellation(run, jobs)) {
            unstarted.push({ id: run.id, runAttempt: run.run_attempt, jobs: 0 });
            continue;
          }
        }
        eligible.push(run);
      }
      receipt.unstartedCancellations = unstarted;
      const first = firstExperimentRun(eligible);
      if (first !== Number(process.env.GITHUB_RUN_ID)) {
        throw new Error(
          "This single-use experiment was already requested by another immutable run",
        );
      }
      receipt.singleUseRun = first;
      return;
    }
  }
  throw new Error("Unable to establish complete single-use dispatch history; no deployment");
}

async function requireMain(sha: string) {
  const main = await github("git/ref/heads/main");
  if ((main.object as { sha?: string })?.sha !== sha) throw new Error("Approved main advanced");
}

async function catalogRead(label: string) {
  const startedAt = performance.now();
  const response = await fetch("https://clawhub.ai/api/v1/skills?limit=1", {
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const body = JSON.parse(text) as { items?: unknown[] };
  observations.push({
    at: new Date().toISOString(),
    label,
    catalogStatus: response.status,
    elapsedMs: performance.now() - startedAt,
    bytes: Buffer.byteLength(text),
    bodySha256: createHash("sha256").update(text).digest("hex"),
    itemCount: body.items?.length,
  });
  if (!response.ok || !Array.isArray(body.items) || body.items.length !== 1) {
    throw new Error("Production catalog read failed");
  }
}

async function observe(
  label: string,
  runId?: string,
): Promise<(Record<string, unknown> & { experimentOwnsControl: boolean }) | undefined> {
  const status = await query("skillsShMirror:getStatusInternal");
  const control = status.control as Record<string, unknown>;
  const owned = syncOwnsActiveControl(control, process.env);
  const runs = status.runs as Array<Record<string, unknown>>;
  const run = runId ? runs.find((value) => value.runId === runId) : runs[0];
  // Snapshot IDs encode the captured corpus; retain only the operational fields.
  const record = run
    ? Object.fromEntries(
        [
          "runId",
          "sourceView",
          "status",
          "sourceTotal",
          "page",
          "offset",
          "counts",
          "operations",
          "startedAt",
          "updatedAt",
          "completedAt",
          "batchLeaseExpiresAt",
        ].map((key) => [key, run[key]]),
      )
    : null;
  observations.push({
    at: new Date().toISOString(),
    label,
    control: { enabled: control.enabled, paused: control.paused, updatedBy: control.updatedBy },
    run: record,
  });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return run ? { ...run, experimentOwnsControl: owned } : undefined;
}

async function main() {
  validateExperimentRequest(process.env);
  await requireSingleDispatch();
  const sha = process.env.EXPERIMENT_SHA!;
  const checkout = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
  if (checkout !== sha) throw new Error("Checkout differs from approved SHA");
  await requireMain(sha);
  for (const [id, workflow] of [
    [process.env.EXPERIMENT_CI_RUN!, "ci.yml"],
    [process.env.EXPERIMENT_TEST_RUN!, "deploy-test.yml"],
  ]) {
    const run = await github(`actions/runs/${id}`);
    if (
      run.head_sha !== sha ||
      run.head_branch !== "main" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.path !== `.github/workflows/${workflow}` ||
      (workflow === "ci.yml" && run.event !== "push")
    )
      throw new Error(`Exact-main successful ${workflow} proof is required`);
    receipt[workflow] = { id, sha, url: run.html_url, conclusion: run.conclusion };
  }
  receipt.sha = sha;
  receipt.workflowRun = process.env.GITHUB_RUN_ID;
  receipt.previousDeployment = await query("appMeta:getDeploymentInfo");
  const previousDeployment = receipt.previousDeployment as {
    appBuildSha: string;
    deployedAt: string;
  };
  if (!/^[a-f0-9]{40}$/.test(previousDeployment.appBuildSha) || !previousDeployment.deployedAt) {
    throw new Error("Known prior backend revision and deploy timestamp are required");
  }
  const capabilities = await query("rolloutCapabilities:getPublicCapabilities");
  const skillsSh = capabilities.skillsSh as Record<string, unknown>;
  const githubSync = capabilities.githubSkillSync as Record<string, unknown>;
  if (
    capabilities.environment !== "production" ||
    skillsSh.mode !== "production" ||
    skillsSh.runtimeEnabled !== true ||
    skillsSh.publicCatalogEnabled !== true ||
    skillsSh.discoveryEnabled !== true ||
    skillsSh.writesEnabled !== false ||
    skillsSh.scanPlanningEnabled !== false ||
    skillsSh.scanAdmissionEnabled !== false ||
    githubSync.mode !== "off" ||
    githubSync.selfServiceEnabled !== false
  )
    throw new Error("Experiment requires enabled production skills.sh and GitHub sync off");
  receipt.rolloutBefore = capabilities;
  await catalogRead("before-sync");
  await observe("before-sync");

  const syncEnv = syncEnvironment(process.env);
  const syncStartedAt = Date.now();
  let syncExit: number | undefined;
  const sync = spawn("bun", ["scripts/skills-sh-catalog/sync.ts"], {
    env: syncEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const syncOutput: string[] = [];
  sync.stdout.on("data", (chunk) => syncOutput.push(String(chunk)));
  sync.stderr.on("data", (chunk) => syncOutput.push(String(chunk)));
  const syncDone = new Promise<number>((resolve, reject) => {
    sync.on("error", (error) => {
      syncExit = 1;
      reject(error);
    });
    sync.on("close", (code) => {
      syncExit = code ?? 1;
      resolve(syncExit);
    });
  });
  // Observe rejection immediately; cleanup below still awaits the same child.
  void syncDone.catch(() => {});
  let deployDone: Promise<string> | undefined;
  try {
    let previousObserved = -1;
    let previousRunId: unknown;
    let selected: Record<string, unknown> | undefined;
    while (Date.now() - syncStartedAt < PROGRESS_WAIT_MS && syncExit === undefined) {
      const run = await observe("waiting-for-progress");
      const counts = run?.counts as { observed?: number } | undefined;
      const observed = counts?.observed ?? 0;
      if (
        run?.sourceView === "leaderboard" &&
        run.status === "running" &&
        run.experimentOwnsControl === true &&
        run.runId === previousRunId &&
        observed > previousObserved &&
        previousObserved > 0 &&
        Number(run.sourceTotal) - observed >= 1_000
      ) {
        selected = run;
        break;
      }
      previousObserved = observed;
      previousRunId = run?.runId;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (!selected) throw new Error("No progressing active sync with work remaining; no deployment");
    const runId = String(selected.runId);
    receipt.selectedSync = runId;
    await requireMain(sha);
    deployDeadline = Date.now() + DEPLOY_LIMIT_MS;
    await command(["x", "tsc", "-p", "packages/schema/tsconfig.json", "--noEmit"]);
    await command(["x", "tsc", "-p", "packages/clawhub/tsconfig.json", "--noEmit"]);
    await command(["x", "tsc", "-p", "convex/tsconfig.json", "--noEmit"]);
    await requireMain(sha);
    const afterTypechecks = await observe("after-typechecks", runId);
    if (
      afterTypechecks?.status !== "running" ||
      !afterTypechecks.experimentOwnsControl ||
      syncExit !== undefined
    ) {
      throw new Error("Sync stopped during typechecks; no deployment");
    }
    await command(["x", "convex", "env", "set", "CLAWHUB_ENV", "production", "--prod"]);
    const beforeDeploy = await observe("immediately-before-deploy", runId);
    if (
      beforeDeploy?.status !== "running" ||
      !beforeDeploy.experimentOwnsControl ||
      syncExit !== undefined
    ) {
      throw new Error("Sync stopped before deployment; no deployment");
    }
    receipt.deployStartedAt = new Date().toISOString();
    let deploymentSettled = false;
    deployDone = command(["x", "convex", "deploy", "--typecheck=enable", "--yes"]).finally(() => {
      deploymentSettled = true;
    });
    void deployDone.catch(() => {});
    let monitoringError: unknown;
    while (!deploymentSettled) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (deploymentSettled) break;
      try {
        await observe("during-deploy", runId);
        await catalogRead("during-deploy");
      } catch (error) {
        // Monitoring cannot abandon a running deployment or its revision finalization.
        monitoringError ??= error;
        receipt.monitoringError = redact(String(error));
        console.error(redact(`Deployment monitor failed: ${String(error)}`));
      }
    }
    await deployDone;
    receipt.deployCompletedAt = new Date().toISOString();
    // Stamp only after the CLI confirms deployment; failures must not advertise new code.
    await command(["x", "convex", "env", "set", "APP_BUILD_SHA", sha, "--prod"]);
    await command([
      "x",
      "convex",
      "env",
      "set",
      "APP_DEPLOYED_AT",
      new Date().toISOString(),
      "--prod",
    ]);
    const afterDeploy = await observe("immediately-after-deploy", runId);
    receipt.overlapVerified =
      afterDeploy?.status === "running" &&
      afterDeploy.experimentOwnsControl === true &&
      Number((afterDeploy.counts as { observed: number }).observed) >
        Number((beforeDeploy.counts as { observed: number }).observed);
    await command(["x", "convex", "run", "promotionsFeed:publishInternal", "--prod"]);
    await command(["run", "verify:convex-contract", "--", "--prod"]);
    receipt.rolloutAfterDeploy = await query("rolloutCapabilities:getPublicCapabilities");
    if (JSON.stringify(receipt.rolloutAfterDeploy) !== JSON.stringify(capabilities)) {
      throw new Error("Production rollout capabilities changed");
    }
    await catalogRead("after-deploy");
    await command(["run", "test:e2e:prod-http"]);
    receipt.deploymentSmokePassed = true;
    if (monitoringError) throw monitoringError;
    deployDeadline = undefined;
    while (syncExit === undefined) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      await observe("after-deploy-sync-progress", runId);
    }
    if ((await syncDone) !== 0)
      throw new Error("Real skills.sh sync failed; inspect its cleanup receipt");
    const proof = JSON.parse(await readFile("skills-sh-sync-proof.json", "utf8"));
    if (proof.ok !== true) throw new Error("Sync did not certify successful completion");
    receipt.syncCompletedProof = proof;
    receipt.deploymentAfter = await query("appMeta:getDeploymentInfo");
    if ((receipt.deploymentAfter as { appBuildSha?: string }).appBuildSha !== sha) {
      throw new Error("Live backend metadata does not match the successful deployment SHA");
    }
    receipt.rolloutAfterSync = await query("rolloutCapabilities:getPublicCapabilities");
    if (JSON.stringify(receipt.rolloutAfterSync) !== JSON.stringify(capabilities)) {
      throw new Error("Rollout capabilities changed after sync cleanup");
    }
    await catalogRead("after-sync");
    await command(["run", "test:e2e:prod-http"]);
    receipt.afterSyncSmokePassed = true;
    receipt.ok = receipt.overlapVerified === true;
    if (!receipt.ok)
      throw new Error("Deployment succeeded but active progressing overlap was not proved");
  } finally {
    // Keep the production mutex until the existing sync CLI finishes its cleanup.
    deployDeadline = undefined;
    if (deployDone) {
      receipt.deploymentTerminal = await deployDone.then(
        () => "success",
        (error) => redact(String(error)),
      );
    }
    receipt.syncExit = await syncDone.catch((error) => redact(String(error)));
    await appendFile(logPath, redact(syncOutput.join("")));
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    receipt.error = redact(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
}
