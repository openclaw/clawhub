#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildMirrorProofHeaders,
  findRecoverableMirrorRun,
  mirrorRateLimitRetryDelayMs,
  type RecoverableMirrorRun,
} from "./prove-mirror-request";

const OUTPUT_PATH = resolve("proof/claw-563/skills-sh-mirror-test-proof.json");
const PROJECTED_SCALE = 700_000;
const MAX_RATE_LIMIT_RETRIES_PER_RUN = 30;
const MAX_RATE_LIMIT_WAIT_MS_PER_RUN = 30 * 60 * 1_000;

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

function callFailure(body: Record<string, unknown>, result: Awaited<ReturnType<typeof callRaw>>) {
  return new Error(
    `${String(body.operation)} returned HTTP ${result.status}: ${JSON.stringify(result.payload)}`,
  );
}

async function call(body: Record<string, unknown>) {
  const result = await callRaw(body);
  if (!result.ok) throw callFailure(body, result);
  return result;
}

function requireRunId(payload: Record<string, unknown>) {
  if (typeof payload.runId !== "string") throw new Error("mirror start did not return runId");
  return payload.runId;
}

async function runMirror(
  reason: string,
  provePauseResume: boolean,
  recoverableRun: RecoverableMirrorRun | null = null,
  capturedSource: CapturedMirrorSource | null = null,
) {
  const attemptStartedAt = Date.now();
  const start = recoverableRun
    ? { payload: recoverableRun }
    : capturedSource
      ? await call({
          operation: "start-replay",
          reason,
          capturedRunId: capturedSource.capturedRunId,
          sourceTotal: capturedSource.externalIds.length,
          sourcePageSize: capturedSource.sourcePageSize,
          sourceMeasuredAt: capturedSource.sourceMeasuredAt,
        })
      : await call({ operation: "start", reason });
  const runId = requireRunId(start.payload);
  let page = recoverableRun?.page ?? 0;
  let offset = recoverableRun?.offset ?? 0;
  let steps = 0;
  let pauseProof: Record<string, unknown> | null = null;
  let run = start.payload as Record<string, unknown>;
  let recovery: Record<string, unknown> | null = null;
  let rateLimitRetries = 0;
  let rateLimitWaitMs = 0;
  if (recoverableRun) {
    recovery = {
      runId,
      status: recoverableRun.status,
      cursor: { page, offset },
      interruptedAtLeastOnce: true,
    };
    if (recoverableRun.status === "paused") {
      run = (
        await call({
          operation: "resume",
          runId,
          reason: "CLAW-563 interrupted run recovery",
        })
      ).payload;
    }
  }
  while (run.status === "running") {
    const stepRequest = capturedSource
      ? {
          operation: "step-replay",
          runId,
          page,
          offset,
          pageLength: Math.min(
            capturedSource.sourcePageSize,
            capturedSource.externalIds.length - page * capturedSource.sourcePageSize,
          ),
          hasMore: (page + 1) * capturedSource.sourcePageSize < capturedSource.externalIds.length,
          sourceTotal: capturedSource.externalIds.length,
          externalIds: capturedSource.externalIds.slice(
            page * capturedSource.sourcePageSize + offset,
            page * capturedSource.sourcePageSize + offset + 50,
          ),
        }
      : { operation: "step", runId, page, offset };
    if (
      capturedSource &&
      (!Array.isArray(stepRequest.externalIds) || stepRequest.externalIds.length < 1)
    ) {
      throw new Error(`captured mirror replay has no rows for cursor ${page}:${offset}`);
    }
    const step = await callRaw(stepRequest);
    if (!step.ok) {
      const delayMs = mirrorRateLimitRetryDelayMs(step.status, step.retryAfter, rateLimitRetries);
      if (
        delayMs === null ||
        rateLimitRetries >= MAX_RATE_LIMIT_RETRIES_PER_RUN ||
        rateLimitWaitMs + delayMs > MAX_RATE_LIMIT_WAIT_MS_PER_RUN
      ) {
        throw callFailure(stepRequest, step);
      }
      rateLimitRetries += 1;
      rateLimitWaitMs += delayMs;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    run = step.payload;
    steps += 1;
    if (typeof run.page !== "number" || typeof run.offset !== "number") {
      throw new Error("mirror step did not return a durable cursor");
    }
    page = run.page;
    offset = run.offset;
    if (provePauseResume && steps === 1) {
      const pause = await call({
        operation: "pause",
        runId,
        reason: "CLAW-563 deliberate pause proof",
      });
      const blocked = await callRaw({ operation: "step", runId, page, offset });
      if (blocked.ok || !JSON.stringify(blocked.payload).includes("paused")) {
        throw new Error("paused mirror step did not fail closed");
      }
      const resume = await call({
        operation: "resume",
        runId,
        reason: "CLAW-563 exact cursor resume proof",
      });
      pauseProof = {
        pause: pause.payload,
        blockedStatus: blocked.status,
        blockedPayload: blocked.payload,
        resume: resume.payload,
        resumeCursor: { page, offset },
      };
    }
  }
  let reconciliationBatches = 0;
  while (run.status === "reconciling") {
    const reconciliation = await call({
      operation: "reconcile",
      runId,
      limit: 250,
    });
    run = reconciliation.payload;
    reconciliationBatches += 1;
  }
  if (run.status !== "completed") {
    throw new Error(`mirror run ended in unexpected status ${String(run.status)}`);
  }
  return {
    runId,
    run,
    source: {
      total: start.payload.sourceTotal,
      measuredAt: start.payload.sourceMeasuredAt,
      pageSize: start.payload.sourcePageSize,
    },
    recovery,
    steps,
    reconciliationBatches,
    pauseProof,
    rateLimitRecovery: {
      retries: rateLimitRetries,
      waitedMs: rateLimitWaitMs,
      retryBudget: MAX_RATE_LIMIT_RETRIES_PER_RUN,
      waitBudgetMs: MAX_RATE_LIMIT_WAIT_MS_PER_RUN,
    },
    elapsedMs: Date.now() - (recoverableRun?.startedAt ?? attemptStartedAt),
    attemptElapsedMs: Date.now() - attemptStartedAt,
  };
}

async function collectPages(
  operation: "page" | "detail-page" | "facet-page",
  validate: (document: Record<string, unknown>) => void,
) {
  const documents: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let calls = 0;
  let count = 0;
  let serializedBytes = 0;
  do {
    const result = await call({ operation, cursor, limit: 500 });
    const page = result.payload.page;
    if (!Array.isArray(page)) throw new Error(`${operation} did not return a page`);
    for (const document of page as Record<string, unknown>[]) {
      validate(document);
      count += 1;
      serializedBytes += Buffer.byteLength(JSON.stringify(document), "utf8");
      if (operation === "page") documents.push(document);
    }
    calls += 1;
    cursor =
      result.payload.isDone === true
        ? null
        : typeof result.payload.continueCursor === "string"
          ? result.payload.continueCursor
          : null;
    if (result.payload.isDone !== true && cursor === null) {
      throw new Error(`${operation} did not return a continuation cursor`);
    }
  } while (cursor);
  return {
    count,
    calls,
    serializedBytes,
    documents,
  };
}

type MirrorRunProof = Awaited<ReturnType<typeof runMirror>>;
type CapturedMirrorSource = {
  capturedRunId: string;
  externalIds: string[];
  sourceMeasuredAt: string;
  sourcePageSize: number;
};

function runCounts(runResult: MirrorRunProof) {
  const counts = runResult.run.counts;
  if (!counts || typeof counts !== "object") throw new Error("mirror run lacks counts");
  return counts as Record<string, number>;
}

function assertZeroCounts(counts: Record<string, number>, names: string[]) {
  for (const name of names) {
    if (counts[name] !== 0) throw new Error(`expected ${name}=0, received ${String(counts[name])}`);
  }
}

function assertRunProof(runResult: MirrorRunProof, mode: "first" | "identical") {
  const counts = runCounts(runResult);
  const total = Number(runResult.source.total);
  const quarantined = counts.quarantined ?? 0;
  const accepted = total - quarantined;
  if (counts.observed !== total) {
    throw new Error(`mirror observed ${String(counts.observed)} of ${total} source rows`);
  }
  assertZeroCounts(counts, ["scansPlanned", "scansAdmitted"]);
  if (counts.rejected !== quarantined || counts.conflicts !== quarantined) {
    throw new Error("mirror rejected rows outside the bounded source quarantine path");
  }
  if ((counts.inserted ?? 0) + (counts.updated ?? 0) + (counts.unchanged ?? 0) !== accepted) {
    throw new Error(`${mode} run digest accounting does not equal the source total`);
  }
  if (
    (counts.detailsInserted ?? 0) +
      (counts.detailsUpdated ?? 0) +
      (counts.detailsUnchanged ?? 0) +
      (counts.detailsMissing ?? 0) !==
    accepted
  ) {
    throw new Error(`${mode} run detail accounting does not equal the source total`);
  }
  if (mode === "identical") {
    assertZeroCounts(counts, [
      "inserted",
      "updated",
      "detailsInserted",
      "detailsUpdated",
      "tombstoned",
      "reactivated",
    ]);
    if (counts.unchanged !== accepted) throw new Error("identical rerun changed a digest");
  }
}

function validateDigestIsolation(document: Record<string, unknown>) {
  if (
    document.active !== true ||
    document.publicVisible !== false ||
    document.installable !== false
  ) {
    throw new Error(`mirror digest isolation failed: ${String(document.externalId)}`);
  }
}

function validateDigest(document: Record<string, unknown>) {
  validateDigestIsolation(document);
  for (const field of [
    "normalizedSlug",
    "normalizedSlugFirstToken",
    "normalizedDisplayName",
    "normalizedDisplayNameFirstToken",
    "searchText",
    "upstreamSourceType",
    "inferredClassifierVersion",
    "inferredTopicClassifierVersion",
    "inferredInputHash",
    "inferredTopicInputHash",
  ]) {
    if (typeof document[field] !== "string" || !document[field]) {
      throw new Error(`mirror digest lacks ${field}: ${String(document.externalId)}`);
    }
  }
  if (
    !Array.isArray(document.inferredCategories) ||
    document.inferredCategories.length < 1 ||
    document.inferredCategories.length > 3 ||
    !Array.isArray(document.inferredTopics) ||
    document.inferredTopics.length > 5 ||
    !["high", "medium", "low"].includes(String(document.inferredCategoryConfidence)) ||
    !["high", "medium", "low"].includes(String(document.inferredTopicConfidence)) ||
    typeof document.inferredAt !== "number"
  ) {
    throw new Error(`mirror digest lacks bounded inference: ${String(document.externalId)}`);
  }
  const scanners = document.upstreamScanners;
  if (!scanners || typeof scanners !== "object" || Array.isArray(scanners)) {
    throw new Error(`mirror digest lacks upstream scanners: ${String(document.externalId)}`);
  }
  for (const provider of ["genAgentTrustHub", "socket", "snyk"]) {
    const scanner = (scanners as Record<string, unknown>)[provider];
    if (
      !scanner ||
      typeof scanner !== "object" ||
      Array.isArray(scanner) ||
      typeof (scanner as Record<string, unknown>).status !== "string"
    ) {
      throw new Error(`mirror digest lacks ${provider} status: ${String(document.externalId)}`);
    }
  }
}

function validateFacet(document: Record<string, unknown>) {
  if (
    document.active !== true ||
    !["category", "topic"].includes(String(document.kind)) ||
    typeof document.term !== "string" ||
    !document.term ||
    typeof document.externalId !== "string" ||
    typeof document.installs !== "number"
  ) {
    throw new Error(`mirror facet is invalid: ${String(document.externalId)}`);
  }
}

function validateDetail(document: Record<string, unknown>) {
  const content = document.content;
  const contentBytes = document.contentBytes;
  if (
    typeof content !== "string" ||
    typeof contentBytes !== "number" ||
    contentBytes > 64 * 1024 ||
    Buffer.byteLength(content, "utf8") !== contentBytes
  ) {
    throw new Error(`mirror detail exceeds its boundary: ${String(document.externalId)}`);
  }
}

function percentile(values: number[], percentileValue: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue))] ?? 0;
}

async function measureReads(externalIds: string[]) {
  const results = [];
  for (const externalId of externalIds) {
    const samples = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const read = await call({ operation: "read", externalId });
      if (!read.payload.digest) throw new Error(`indexed read missed ${externalId}`);
      samples.push(read.elapsedMs);
    }
    results.push({
      externalId,
      samplesMs: samples,
      medianMs: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
    });
  }
  return results;
}

const cronSource = await readFile(resolve("convex/crons.ts"), "utf8");
if (cronSource.includes("skillsShMirror") || cronSource.includes("skills-sh/mirror")) {
  throw new Error("skills.sh mirror scheduler reference exists");
}

const proofStartedAt = Date.now();
let proof: Record<string, unknown>;
await call({
  operation: "configure",
  enabled: true,
  reason: "CLAW-563 full authenticated Test mirror proof",
});
try {
  const isolationBefore = (await call({ operation: "isolation" })).payload;
  const statusBefore = (await call({ operation: "status" })).payload;
  const recoverableRun = findRecoverableMirrorRun(statusBefore);
  const firstRun = await runMirror("CLAW-563 complete authenticated mirror", true, recoverableRun);
  const statusAfterFirstRun = (await call({ operation: "status" })).payload;
  const latestRunConflicts = Array.isArray(statusAfterFirstRun.latestRunConflicts)
    ? (statusAfterFirstRun.latestRunConflicts as Record<string, unknown>[])
    : [];
  const capturedAfterLive = await collectPages("page", validateDigestIsolation);
  const liveCapturedSource: CapturedMirrorSource = {
    capturedRunId: firstRun.runId,
    externalIds: capturedAfterLive.documents.map((document) => {
      if (typeof document.externalId !== "string") {
        throw new Error("captured mirror digest lacks externalId");
      }
      return document.externalId;
    }),
    sourceMeasuredAt: String(firstRun.source.measuredAt),
    sourcePageSize: Number(firstRun.source.pageSize),
  };
  const normalizationRun = await runMirror(
    "CLAW-563 authenticated captured snapshot normalization",
    false,
    null,
    liveCapturedSource,
  );
  const capturedAfterNormalization = await collectPages("page", validateDigest);
  const normalizedCapturedSource: CapturedMirrorSource = {
    ...liveCapturedSource,
    capturedRunId: normalizationRun.runId,
    externalIds: capturedAfterNormalization.documents.map((document) => {
      if (typeof document.externalId !== "string") {
        throw new Error("normalized mirror digest lacks externalId");
      }
      return document.externalId;
    }),
  };
  const identicalRerun = await runMirror(
    "CLAW-563 authenticated captured snapshot identical rerun",
    false,
    null,
    normalizedCapturedSource,
  );
  assertRunProof(firstRun, "first");
  assertRunProof(normalizationRun, "first");
  assertRunProof(identicalRerun, "identical");
  const [digests, details, facets] = await Promise.all([
    collectPages("page", validateDigest),
    collectPages("detail-page", validateDetail),
    collectPages("facet-page", validateFacet),
  ]);
  const firstCounts = runCounts(firstRun);
  const quarantinedCount = firstCounts.quarantined ?? 0;
  const quarantinedPreservedCount = firstCounts.quarantinedPreserved ?? 0;
  const acceptedCount = Number(firstRun.source.total) - quarantinedCount;
  const expectedDigestCount = acceptedCount + quarantinedPreservedCount;
  if (digests.count !== expectedDigestCount) {
    throw new Error(
      `mirror digest count ${digests.count} does not match accepted or preserved total ${expectedDigestCount}`,
    );
  }
  if (facets.count < digests.count) {
    throw new Error("mirror facets do not cover every digest category fallback");
  }
  const quarantineSamples = latestRunConflicts
    .filter(
      (conflict) => conflict.runId === firstRun.runId && conflict.kind === "source-quarantine",
    )
    .slice(0, 50);
  if (quarantineSamples.length !== Math.min(quarantinedCount, 50)) {
    throw new Error("mirror status did not expose the latest run quarantine samples");
  }
  const sampleIndexes = [0, Math.floor(digests.count / 2), digests.count - 1];
  const sampleExternalIds = sampleIndexes.map((index) => {
    const externalId = digests.documents[index]?.externalId;
    if (typeof externalId !== "string") throw new Error("mirror digest lacks externalId");
    return externalId;
  });
  const indexedReads = await measureReads(sampleExternalIds);
  const isolationAfter = (await call({ operation: "isolation" })).payload;
  if (JSON.stringify(isolationBefore) !== JSON.stringify(isolationAfter)) {
    throw new Error("mirror proof changed scan isolation state");
  }
  const firstOperations = firstRun.run.operations as Record<string, number>;
  const serializedStorageBytes =
    digests.serializedBytes + details.serializedBytes + facets.serializedBytes;
  const rows = digests.count;
  const sourceRows = Number(firstRun.source.total);
  const perRow = {
    serializedStorageBytes: serializedStorageBytes / rows,
    dbWrites: firstOperations.dbWrites / sourceRows,
    dbReads: firstOperations.dbReads / sourceRows,
    sourceRequests: firstOperations.sourceRequests / sourceRows,
    sourceBytes: firstOperations.sourceBytes / sourceRows,
  };
  proof = {
    generatedAt: new Date().toISOString(),
    target: {
      environment: "permanent Test",
      gateUrl: targetUrl,
      productionWrites: 0,
      schedules: 0,
      publicVisibility: false,
      installability: false,
      publisherAttachment: false,
      scanPlanning: false,
      scanAdmission: false,
    },
    sourceContract: {
      authenticated: "Vercel OIDC",
      measuredTotal: firstRun.source.total,
      pageSize: firstRun.source.pageSize,
      measuredAt: firstRun.source.measuredAt,
      corpusBelowRequestedTenThousand: Number(firstRun.source.total) < 10_000,
      documentedRateLimitRequestsPerMinute: 600,
      fetchPolicy: {
        mirrorBatchRows: 50,
        sourcePageRows: 500,
        detailAndPageConcurrency: 8,
        minimumApiRequestIntervalMs: 125,
        identityPage:
          "512 KiB structural HTML fallback only for exact no-install well-known owner/repo rows",
        recovery: "durable cursor retry with bounded Retry-After recovery",
      },
    },
    firstRun,
    normalizationRun,
    identicalRerun,
    quarantine: {
      rejected: firstCounts.rejected,
      quarantined: quarantinedCount,
      preserved: quarantinedPreservedCount,
      samples: quarantineSamples,
    },
    storage: {
      digests: {
        count: digests.count,
        serializedBytes: digests.serializedBytes,
        pageReads: digests.calls,
      },
      details: {
        count: details.count,
        serializedBytes: details.serializedBytes,
        pageReads: details.calls,
      },
      facets: {
        count: facets.count,
        serializedBytes: facets.serializedBytes,
        pageReads: facets.calls,
      },
      totalSerializedBytes: serializedStorageBytes,
      bytesPerSourceRow: perRow.serializedStorageBytes,
    },
    isolation: {
      before: isolationBefore,
      after: isolationAfter,
      unchanged: true,
    },
    indexedReads,
    projectedFullScale: {
      assumedRows: PROJECTED_SCALE,
      serializedStorageBytes: Math.ceil(perRow.serializedStorageBytes * PROJECTED_SCALE),
      dbWrites: Math.ceil(perRow.dbWrites * PROJECTED_SCALE),
      dbReads: Math.ceil(perRow.dbReads * PROJECTED_SCALE),
      sourceRequests: Math.ceil(perRow.sourceRequests * PROJECTED_SCALE),
      sourceBytes: Math.ceil(perRow.sourceBytes * PROJECTED_SCALE),
    },
    runtime: {
      elapsedMs: Date.now() - proofStartedAt,
    },
  };
} finally {
  const disabled = await callRaw({
    operation: "configure",
    enabled: false,
    reason: "CLAW-563 proof cleanup: retain mirror hidden and paused",
  });
  if (!disabled.ok) {
    throw new Error(`mirror cleanup failed: ${JSON.stringify(disabled.payload)}`);
  }
}

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ outputPath: OUTPUT_PATH, ...proof }));
