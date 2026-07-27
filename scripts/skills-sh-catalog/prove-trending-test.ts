#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildMirrorProofHeaders } from "./prove-mirror-request";

const OUTPUT_PATH = resolve("proof/claw-589/skills-sh-trending-test-proof.json");
const RUN_STATE_PATH = resolve("proof/claw-589/active-run.json");
const MAX_STEPS = 2_000;
const HYDRATION_BOUND = 50;

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const targetUrl = requireEnv("CLAWHUB_TEST_MIRROR_GATE_URL");
const operatorAuthorization = requireEnv("CLAWHUB_TEST_OPERATOR_TOKEN");
const vercelAutomationBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

async function callRaw(body: Record<string, unknown>) {
  const startedAt = performance.now();
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: buildMirrorProofHeaders(operatorAuthorization, vercelAutomationBypassSecret),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { text };
  }
  return {
    ok: response.ok,
    status: response.status,
    elapsedMs: performance.now() - startedAt,
    payload,
    retryAfter: response.headers.get("retry-after"),
  };
}

async function call(body: Record<string, unknown>) {
  const result = await callRaw(body);
  if (!result.ok) {
    throw new Error(
      `${String(body.operation)} returned HTTP ${result.status}: ${JSON.stringify(result.payload)}`,
    );
  }
  return result;
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || !value) throw new Error(`${key} is missing`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} is missing`);
  return value;
}

function requiredCounts(record: Record<string, unknown>) {
  const counts = record.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    throw new Error("trending run counts are missing");
  }
  return counts as Record<string, unknown>;
}

async function finishTrendingRun(start: Record<string, unknown>) {
  let run = start;
  let steps = 0;
  const missingExternalIds = new Set<string>();
  while (run.status === "running") {
    if (steps >= MAX_STEPS) throw new Error("trending proof exceeded the step bound");
    const step = await call({
      operation: "step-trending",
      runId: requiredString(run, "runId"),
      page: requiredNumber(run, "page"),
      offset: requiredNumber(run, "offset"),
    });
    run = step.payload;
    if (Array.isArray(run.missingExternalIds)) {
      for (const value of run.missingExternalIds) {
        if (typeof value === "string") missingExternalIds.add(value);
      }
    }
    steps += 1;
  }
  if (run.status !== "completed") {
    throw new Error(`trending run ended in unexpected status ${String(run.status)}`);
  }
  const counts = requiredCounts(run);
  const observed = requiredNumber(counts, "observed");
  const joined = requiredNumber(counts, "trendingJoined");
  const missing = requiredNumber(counts, "trendingMissing");
  const hydrationAttempts = requiredNumber(counts, "trendingHydrationAttempts");
  if (observed !== requiredNumber(run, "sourceTotal") || joined + missing !== observed) {
    throw new Error("trending join accounting does not reconcile to the source total");
  }
  if (hydrationAttempts > HYDRATION_BOUND) {
    throw new Error("trending hydration exceeded the accepted bound");
  }
  if (
    requiredNumber(counts, "scansPlanned") !== 0 ||
    requiredNumber(counts, "scansAdmitted") !== 0
  ) {
    throw new Error("trending observation created scan work");
  }
  return {
    run,
    steps,
    missingExternalIds: Array.from(missingExternalIds).sort(),
  };
}

function staleTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("sourceMeasuredAt is invalid");
  return new Date(timestamp - 1).toISOString();
}

let activeRunId: string | null = null;

async function recordActiveRun(runId: string | null) {
  activeRunId = runId;
  await mkdir(dirname(RUN_STATE_PATH), { recursive: true });
  await writeFile(
    RUN_STATE_PATH,
    `${JSON.stringify({ runId, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

const proofStartedAt = Date.now();
let proof: Record<string, unknown> = {};
try {
  await call({
    operation: "configure",
    enabled: true,
    reason: "CLAW-589 exact-head trending rank overlay proof",
  });
  const isolationBefore = (await call({ operation: "isolation" })).payload;
  const liveStart = (
    await call({
      operation: "start-trending",
      reason: "CLAW-589 authenticated trending observation",
    })
  ).payload;
  await recordActiveRun(requiredString(liveStart, "runId"));
  const sampleExternalIds = Array.isArray(liveStart.sampleExternalIds)
    ? liveStart.sampleExternalIds.filter((value): value is string => typeof value === "string")
    : [];
  const live = await finishTrendingRun(liveStart);
  await recordActiveRun(null);
  const observedAt = requiredString(live.run, "sourceMeasuredAt");

  const replayStart = (
    await call({
      operation: "start-trending-replay",
      reason: "CLAW-589 idempotent captured replay",
      capturedRunId: requiredString(live.run, "runId"),
      sourceMeasuredAt: observedAt,
    })
  ).payload;
  await recordActiveRun(requiredString(replayStart, "runId"));
  const replay = await finishTrendingRun(replayStart);
  await recordActiveRun(null);
  const replayCounts = requiredCounts(replay.run);
  if (
    requiredNumber(replayCounts, "trendingUpdated") !== 0 ||
    requiredNumber(replayCounts, "trendingUnchanged") !==
      requiredNumber(replayCounts, "trendingJoined")
  ) {
    throw new Error("captured trending replay was not idempotent");
  }

  const staleStart = (
    await call({
      operation: "start-trending-replay",
      reason: "CLAW-589 stale-write rejection",
      capturedRunId: requiredString(live.run, "runId"),
      sourceMeasuredAt: staleTimestamp(observedAt),
    })
  ).payload;
  await recordActiveRun(requiredString(staleStart, "runId"));
  const stale = await finishTrendingRun(staleStart);
  await recordActiveRun(null);
  const staleCounts = requiredCounts(stale.run);
  if (
    requiredNumber(staleCounts, "trendingUpdated") !== 0 ||
    requiredNumber(staleCounts, "trendingStaleRejected") !==
      requiredNumber(staleCounts, "trendingJoined")
  ) {
    throw new Error("stale trending observation was not rejected");
  }

  const samples = await Promise.all(
    sampleExternalIds.map(async (externalId) => {
      const read = (await call({ operation: "read", externalId })).payload;
      const digest = read.digest;
      if (!digest || typeof digest !== "object" || Array.isArray(digest)) {
        throw new Error(`trending sample digest is missing: ${externalId}`);
      }
      const row = digest as Record<string, unknown>;
      if (
        row.externalId !== externalId ||
        typeof row.trendingRank !== "number" ||
        typeof row.trendingLifetimeInstalls !== "number" ||
        typeof row.trendingObservedAt !== "number" ||
        "trending24hInstalls" in row ||
        row.publicVisible !== false ||
        row.installable !== false
      ) {
        throw new Error(`trending sample contract failed: ${externalId}`);
      }
      return {
        externalId,
        trendingRank: row.trendingRank,
        trendingLifetimeInstalls: row.trendingLifetimeInstalls,
        trendingObservedAt: row.trendingObservedAt,
      };
    }),
  );
  const isolationAfter = (await call({ operation: "isolation" })).payload;
  if (JSON.stringify(isolationAfter) !== JSON.stringify(isolationBefore)) {
    throw new Error("trending proof changed scan isolation state");
  }

  proof = {
    generatedAt: new Date().toISOString(),
    target: {
      environment: "permanent Test",
      gateUrl: targetUrl,
      productionWrites: 0,
      schedules: 0,
      publicVisibility: false,
      installability: false,
      scanPlanning: false,
      scanAdmission: false,
    },
    source: {
      view: "trending",
      total: requiredNumber(liveStart, "sourceTotal"),
      requestCount: requiredNumber(liveStart, "sourceMeasurementRequests"),
      durationMs: requiredNumber(liveStart, "sourceMeasurementDurationMs"),
      observedAt,
      evidence: liveStart.sourceEvidence,
      capture: liveStart.sourceCapture,
      countContract: {
        ranking: "authoritative rolling-24h upstream order",
        installs: "lifetime deduplicated installs",
        trending24hInstalls: null,
      },
    },
    live,
    replay,
    stale,
    samples,
    hydration: {
      maximumRowsPerRun: HYDRATION_BOUND,
      attempts: requiredNumber(requiredCounts(live.run), "trendingHydrationAttempts"),
      hydrated: requiredNumber(requiredCounts(live.run), "trendingHydrated"),
      failed: requiredNumber(requiredCounts(live.run), "trendingHydrationFailed"),
      withinBound: true,
      normalizer: "fetchSkillsShMirrorBatch",
    },
    isolation: { before: isolationBefore, after: isolationAfter, unchanged: true },
    runtime: { elapsedMs: Date.now() - proofStartedAt },
  };
} finally {
  let cleanupFailure: string | null = null;
  if (activeRunId) {
    const run = await callRaw({ operation: "run", runId: activeRunId });
    if (!run.ok) {
      cleanupFailure = `failed to read owned trending run: ${JSON.stringify(run.payload)}`;
    } else if (["running", "paused", "reconciling"].includes(String(run.payload.status))) {
      const discarded = await callRaw({
        operation: "discard",
        runId: activeRunId,
        reason: "CLAW-589 fail-closed cleanup",
      });
      if (!discarded.ok) {
        cleanupFailure = `failed to discard owned trending run: ${JSON.stringify(discarded.payload)}`;
      }
    }
    if (!cleanupFailure) await recordActiveRun(null);
  }
  const disabled = await callRaw({
    operation: "configure",
    enabled: false,
    reason: "CLAW-589 proof cleanup: retain mirror hidden and paused",
  });
  if (!disabled.ok) {
    throw new Error(`trending proof cleanup failed: ${JSON.stringify(disabled.payload)}`);
  }
  if (cleanupFailure) throw new Error(cleanupFailure);
}

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ outputPath: OUTPUT_PATH, ...proof }));
