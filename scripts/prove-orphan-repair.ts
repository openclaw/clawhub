#!/usr/bin/env bun
// Captures end-to-end proof for the #3349 orphaned-pending-version repair
// against a real (non-production) cloud Convex deployment.
//
// The script never fabricates the broken state: it publishes 1.0.0 normally,
// stages 1.0.1 through the real staged publish path, reports clean checks
// through the real scanner-worker mutations, then lets the real finalization
// claim/release contract fail until the retry cap terminalizes the attempt.
// Public visibility is read through the deployment's real HTTP API before and
// after the repair.
//
// Usage (from a checkout linked to a dev/preview deployment):
//   bun scripts/prove-orphan-repair.ts
//   bun scripts/prove-orphan-repair.ts --out proof/pr-3401
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROOF_SLUG = "orphan-repair-proof";
const STRANDED_VERSION = "1.0.1";
const REPAIR_CONFIRM = "repair-orphaned-pending-skill-version";
const SWEEP_CONFIRM = "repair-orphaned-pending-skill-versions-sweep";

export type ProofOptions = { outDir: string; deployment?: string; siteUrl?: string };

export function parseProofArgs(args: string[]): ProofOptions {
  const options: ProofOptions = { outDir: join("proof", "pr-3401") };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") options.outDir = args[++index] ?? options.outDir;
    else if (arg.startsWith("--out=")) options.outDir = arg.slice("--out=".length);
    else if (arg === "--deployment") options.deployment = args[++index];
    else if (arg.startsWith("--deployment="))
      options.deployment = arg.slice("--deployment=".length);
    else if (arg === "--site-url") options.siteUrl = args[++index];
    else if (arg.startsWith("--site-url=")) options.siteUrl = arg.slice("--site-url=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

// Hard stop before anything touches a deployment: this harness is dev-only, and
// its Convex-side guard (assertLocalDevSeedAllowed) refuses production too.
export function assertNonProductionTarget(env: NodeJS.ProcessEnv = process.env) {
  const deployKey = env.CONVEX_DEPLOY_KEY?.trim() ?? "";
  const deployment = sanitizeDeploymentName(env.CONVEX_DEPLOYMENT);
  if (deployKey.startsWith("prod:") && !deployKey.includes("|preview")) {
    throw new Error("prove-orphan-repair refuses a production CONVEX_DEPLOY_KEY");
  }
  if (deployment && !/^(dev|local|anonymous|preview):/.test(deployment)) {
    throw new Error(
      `prove-orphan-repair requires a dev/local/preview CONVEX_DEPLOYMENT; received "${deployment}"`,
    );
  }
  if (!deployment && !deployKey) {
    throw new Error(
      "No Convex deployment selected. Run `bunx convex dev --once` (or set CONVEX_DEPLOY_KEY) first.",
    );
  }
  return { deployment, usingDeployKey: Boolean(deployKey) };
}

function sanitizeDeploymentName(value: string | undefined) {
  if (!value) return "";
  // .env.local often has: CONVEX_DEPLOYMENT=dev:foo # team: x, project: y
  return value.split("#")[0]?.trim() ?? "";
}

function convexRun(fn: string, args: unknown, deployment?: string) {
  const target = deployment ? ["--deployment", deployment] : [];
  const payload = JSON.stringify(args ?? {});
  // Spawn the real bun.exe (process.execPath). On Windows, `bun`/`bunx` on PATH
  // are PowerShell wrappers that uv_spawn cannot resolve without shell:true, and
  // shell:true mangles JSON argv quotes.
  const result = spawnSync(
    process.execPath,
    ["x", "convex", "run", ...target, "--no-push", fn, payload],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CONVEX_DEPLOYMENT: sanitizeDeploymentName(deployment ?? process.env.CONVEX_DEPLOYMENT),
      },
      encoding: "utf8",
    },
  );
  if (result.error) {
    throw new Error(`convex run ${fn} failed to spawn: ${result.error.message}`);
  }
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  const combined = `${stdout}\n${stderr}`.trim();
  const uvExitNoise = /Assertion failed:.*UV_HANDLE_CLOSING/.test(combined);
  const hardFailure = /Failed to run function|✖ Failed|Error: \[Request ID/.test(combined);
  const parsed = extractTrailingJsonObject(combined);
  if (hardFailure || (parsed === undefined && result.status !== 0 && !uvExitNoise)) {
    throw new Error(`convex run ${fn} failed (status=${String(result.status)}):\n${combined}`);
  }
  if (parsed === undefined) {
    if (result.status === 0 || result.status === null || uvExitNoise) return null;
    throw new Error(
      `convex run ${fn} returned no JSON (status=${String(result.status)}):\n${combined}`,
    );
  }
  return parsed;
}

function extractTrailingJsonObject(text: string): unknown | undefined {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escape) escape = false;
        else if (char === "\\") escape = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

async function httpProbe(siteUrl: string, path: string, token?: string) {
  const url = `${siteUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text for non-JSON responses
  }
  return { url, status: response.status, body };
}

async function captureVisibility(siteUrl: string, token: string) {
  const versionPath = `/api/v1/skills/${PROOF_SLUG}/versions/${STRANDED_VERSION}`;
  return {
    anonymousSkill: await httpProbe(siteUrl, `/api/v1/skills/${PROOF_SLUG}`),
    anonymousVersion: await httpProbe(siteUrl, versionPath),
    ownerVersion: await httpProbe(siteUrl, versionPath, token),
  };
}

function resolveSiteUrl(options: ProofOptions) {
  const explicit = options.siteUrl ?? process.env.CLAWHUB_PROOF_SITE_URL;
  if (explicit) return explicit;
  const convexUrl = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  if (convexUrl) return convexUrl.replace(".convex.cloud", ".convex.site");
  throw new Error(
    "Cannot resolve the deployment HTTP URL. Pass --site-url https://<deployment>.convex.site",
  );
}

async function main() {
  const options = parseProofArgs(process.argv.slice(2));
  const target = assertNonProductionTarget();
  const deployment = options.deployment;
  const siteUrl = resolveSiteUrl(options);
  mkdirSync(options.outDir, { recursive: true });

  const steps: Array<{ step: string; detail: unknown }> = [];
  const record = (step: string, detail: unknown) => {
    steps.push({ step, detail });
    console.log(`\n### ${step}\n${JSON.stringify(detail, null, 2)}`);
  };

  record("target", { deployment: target.deployment, siteUrl });

  const fixture = convexRun("orphanRepairProofDevSeed:seedProofFixture", {}, deployment) as {
    slug: string;
    token: string;
    strandedVersionId: string;
    attemptId: string | null;
    userId: string;
  };
  record("seed-fixture", { ...fixture, token: "<redacted>" });
  if (!fixture.attemptId) throw new Error("Staged publish returned no attempt id");
  if (!fixture.userId) throw new Error("Seed fixture returned no userId for audit actor");

  // Scenario A — security gate: incomplete ClawScan must block repair and
  // must not claim operator orphan repair is available.
  record(
    "scenario-a-incomplete-checks-dry-run",
    convexRun(
      "maintenance:repairOrphanedPendingSkillVersionInternal",
      { versionId: fixture.strandedVersionId, dryRun: true },
      deployment,
    ),
  );
  const incompleteVisibility = await captureVisibility(siteUrl, fixture.token);
  record("scenario-a-incomplete-checks-http", incompleteVisibility);

  // Scenario C — finalized but incomplete: temporarily force that inconsistent
  // state, prove repair refuses, then restore for the capped path.
  record(
    "scenario-c-force-finalized-incomplete",
    convexRun(
      "orphanRepairProofDevSeed:forceFinalizedIncompleteChecksMutation",
      { attemptId: fixture.attemptId },
      deployment,
    ),
  );
  record(
    "scenario-c-repair-blocked",
    convexRun(
      "maintenance:repairOrphanedPendingSkillVersionInternal",
      { versionId: fixture.strandedVersionId, dryRun: false, confirm: REPAIR_CONFIRM },
      deployment,
    ),
  );
  record(
    "scenario-c-state",
    convexRun("orphanRepairProofDevSeed:inspectProofState", {}, deployment),
  );
  record(
    "restore-pending-checks-after-scenario-c",
    convexRun(
      "orphanRepairProofDevSeed:restoreAttemptPendingChecksMutation",
      { attemptId: fixture.attemptId },
      deployment,
    ),
  );
  record(
    "complete-prepublication-checks",
    convexRun(
      "orphanRepairProofDevSeed:completeProofChecks",
      { attemptId: fixture.attemptId },
      deployment,
    ),
  );

  // Scenario D — failed incomplete checks: owner must not see a repair hint.
  record(
    "scenario-d-force-failed-incomplete",
    convexRun(
      "orphanRepairProofDevSeed:forceFailedIncompleteChecksMutation",
      { attemptId: fixture.attemptId },
      deployment,
    ),
  );
  const failedIncompleteVisibility = await captureVisibility(siteUrl, fixture.token);
  record("scenario-d-failed-incomplete-http", failedIncompleteVisibility);
  record(
    "restore-pending-checks-after-scenario-d",
    convexRun(
      "orphanRepairProofDevSeed:restoreAttemptPendingChecksMutation",
      { attemptId: fixture.attemptId },
      deployment,
    ),
  );
  record(
    "complete-prepublication-checks-for-cap",
    convexRun(
      "orphanRepairProofDevSeed:completeProofChecks",
      { attemptId: fixture.attemptId },
      deployment,
    ),
  );

  record(
    "deactivate-owner-to-fail-finalization",
    convexRun(
      "orphanRepairProofDevSeed:setProofOwnerAvailabilityMutation",
      { deactivated: true },
      deployment,
    ),
  );
  record(
    "drive-finalization-to-retry-cap",
    convexRun(
      "orphanRepairProofDevSeed:driveProofFinalizationToCap",
      { versionId: fixture.strandedVersionId },
      deployment,
    ),
  );
  record(
    "reactivate-owner",
    convexRun(
      "orphanRepairProofDevSeed:setProofOwnerAvailabilityMutation",
      { deactivated: false },
      deployment,
    ),
  );

  const beforeState = convexRun("orphanRepairProofDevSeed:inspectProofState", {}, deployment);
  record("before-repair-state", beforeState);
  const beforeVisibility = await captureVisibility(siteUrl, fixture.token);
  record("before-repair-http", beforeVisibility);

  record(
    "repair-dry-run",
    convexRun(
      "maintenance:repairOrphanedPendingSkillVersionInternal",
      { versionId: fixture.strandedVersionId, dryRun: true },
      deployment,
    ),
  );
  record(
    "repair-apply",
    convexRun(
      "maintenance:repairOrphanedPendingSkillVersionInternal",
      {
        versionId: fixture.strandedVersionId,
        dryRun: false,
        confirm: REPAIR_CONFIRM,
        actorUserId: fixture.userId,
      },
      deployment,
    ),
  );

  const afterState = convexRun("orphanRepairProofDevSeed:inspectProofState", {}, deployment);
  record("after-repair-state", afterState);
  const afterVisibility = await captureVisibility(siteUrl, fixture.token);
  record("after-repair-http", afterVisibility);

  record(
    "repair-rerun-idempotence",
    convexRun(
      "maintenance:repairOrphanedPendingSkillVersionInternal",
      { versionId: fixture.strandedVersionId, dryRun: false, confirm: REPAIR_CONFIRM },
      deployment,
    ),
  );
  record(
    "sweep-after-repair",
    convexRun(
      "maintenance:repairOrphanedPendingSkillVersionsSweep",
      { dryRun: false, confirm: SWEEP_CONFIRM },
      deployment,
    ),
  );
  const finalState = convexRun("orphanRepairProofDevSeed:inspectProofState", {}, deployment);
  record("final-state", finalState);

  const tipSha = (
    spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout ?? ""
  ).trim();
  const upstreamMainSha = (
    spawnSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).stdout ?? ""
  ).trim();
  const payload = {
    capturedAt: new Date().toISOString(),
    upstreamMainSha,
    branchTipSha: tipSha,
    deployment: target.deployment,
    siteUrl,
    slug: PROOF_SLUG,
    strandedVersion: STRANDED_VERSION,
    steps,
  };
  mkdirSync(options.outDir, { recursive: true });
  const jsonPath = join(options.outDir, "orphan-repair-proof.json");
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  const step = (name: string) => steps.find((entry) => entry.step === name)?.detail;
  writeFileSync(
    join(options.outDir, "http-before.txt"),
    `${JSON.stringify(
      {
        scenarioA_incomplete: step("scenario-a-incomplete-checks-http"),
        scenarioD_failedIncomplete: step("scenario-d-failed-incomplete-http"),
        beforeRepair: step("before-repair-http"),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(options.outDir, "http-after.txt"),
    `${JSON.stringify(step("after-repair-http") ?? null, null, 2)}\n`,
  );
  writeFileSync(
    join(options.outDir, "audit-proof.json"),
    `${JSON.stringify(
      {
        afterRepairAudits: (step("after-repair-state") as { recoveryAudits?: unknown } | undefined)
          ?.recoveryAudits,
        scenarioCState: step("scenario-c-state"),
        dryRunDidNotAudit: step("repair-dry-run"),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(options.outDir, "README.md"),
    [
      "# PR #3401 orphan-repair Convex proof",
      "",
      `- upstream/main: \`${upstreamMainSha}\``,
      `- branch tip: \`${tipSha}\``,
      `- deployment: \`${target.deployment}\``,
      `- capturedAt (UTC): \`${payload.capturedAt}\``,
      `- site: \`${siteUrl}\``,
      "",
      "## Commands",
      "",
      "```text",
      "bunx convex dev --once",
      "bunx convex codegen --typecheck enable",
      `bun scripts/prove-orphan-repair.ts --out ${options.outDir}`,
      "```",
      "",
      "## Scenarios",
      "",
      "- A: incomplete ClawScan blocks repair; owner HTTP must not claim operator repair",
      "- B: capped clean failed attempt repairs atomically with audit + followups",
      "- C: finalized + incomplete checks rejected (Patrick P1)",
      "- D: failed + incomplete checks owner HTTP has no repair hint (Patrick P2)",
      "",
      "Tokens and auth headers are redacted in JSON artifacts.",
      "",
    ].join("\n"),
  );
  console.log(`\nWrote ${jsonPath}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
