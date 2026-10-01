#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { assertFirstPageContract, latencySummary, type ProofSampleRow } from "./proof-contract";

const OUTPUT_PATH = resolve("proof/claw-590/canonical-trending-test-proof.json");
const ACTIVE_PATH = resolve("proof/claw-590/active-snapshot.json");
const SAMPLE_COUNT = 3;
const PAGE_LIMIT = 20;
const MAX_PAGES = 1_000;
const CONFIRM = "manage-claw-590-canonical-trending-test-proof";
const execFileAsync = promisify(execFile);

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const deploySha = requireEnv("DEPLOY_SHA");
if (!/^[0-9a-f]{40}$/.test(deploySha)) throw new Error("DEPLOY_SHA must be a full commit SHA");
const siteUrl = requireEnv("TEST_SITE_URL").replace(/\/$/, "");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
const snapshotId = `claw-590-proof-${deploySha}`;

type ApiItem = {
  id: string;
  rank: number;
  lane: string;
  metrics: {
    trending24hInstalls: number | null;
    trending24hBookmarks: number | null;
    lifetimeInstalls: number | null;
    lifetimeInstallsPeriod: string;
  };
};

type ApiPage = {
  kind: string;
  snapshotId: string;
  snapshotCursor: string;
  generatedAt: string;
  windowHours: number;
  rankingVersion: string;
  totalItems: number;
  items: ApiItem[];
  nextCursor: string | null;
};

async function convexRun(functionName: string, args: Record<string, unknown>) {
  const { stdout } = await execFileAsync(
    "bunx",
    ["convex", "run", "--no-push", functionName, JSON.stringify(args)],
    { env: process.env, maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

async function fetchPage(cursor: string | null) {
  const url = new URL("/api/v1/trending", siteUrl);
  url.searchParams.set("kind", "skills");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (cursor) url.searchParams.set("cursor", cursor);
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
  });
  const elapsedMs = performance.now() - startedAt;
  const text = await response.text();
  if (!response.ok) throw new Error(`Trending API returned HTTP ${response.status}: ${text}`);
  return { elapsedMs, page: JSON.parse(text) as ApiPage };
}

function orderedIds(page: ApiPage) {
  return page.items.map((item) => item.id);
}

await mkdir(dirname(ACTIVE_PATH), { recursive: true });
await writeFile(
  ACTIVE_PATH,
  `${JSON.stringify({ armed: true, snapshotId, deploySha }, null, 2)}\n`,
);

const materialization = await convexRun("canonicalTrending:materializeInternal", {
  proofSnapshotId: snapshotId,
});
if (materialization.status !== "ready" || materialization.snapshotId !== snapshotId) {
  throw new Error(`Unexpected materialization result: ${JSON.stringify(materialization)}`);
}

const firstSamples = [];
for (let index = 0; index < SAMPLE_COUNT; index += 1) firstSamples.push(await fetchPage(null));
const firstPage = firstSamples[0]!.page;
for (const sample of firstSamples) {
  if (
    sample.page.snapshotId !== snapshotId ||
    sample.page.snapshotCursor !== firstPage.snapshotCursor ||
    sample.page.nextCursor !== firstPage.nextCursor ||
    JSON.stringify(orderedIds(sample.page)) !== JSON.stringify(orderedIds(firstPage))
  ) {
    throw new Error("Trending first-page cursor or order changed between samples");
  }
}

const allItems = [...firstPage.items];
let cursor = firstPage.nextCursor;
let pages = 1;
while (cursor) {
  if (pages >= MAX_PAGES) throw new Error("Trending pagination exceeded its proof bound");
  const result = await fetchPage(cursor);
  if (result.page.snapshotId !== snapshotId)
    throw new Error("Trending pagination changed snapshot");
  allItems.push(...result.page.items);
  cursor = result.page.nextCursor;
  pages += 1;
}
if (allItems.length !== firstPage.totalItems) {
  throw new Error(`Trending pagination returned ${allItems.length}/${firstPage.totalItems} items`);
}
if (new Set(allItems.map((item) => item.id)).size !== allItems.length) {
  throw new Error("Trending pagination returned duplicate identities");
}
if (allItems.some((item, index) => item.rank !== index + 1)) {
  throw new Error("Trending pagination returned unstable or discontinuous ranks");
}

const readback = await convexRun("canonicalTrendingTestFixtures:readCanonicalTrendingProof", {
  confirm: CONFIRM,
  snapshotId,
});
if (readback.present !== true || readback.status !== "ready") {
  throw new Error(`Owned snapshot readback failed: ${JSON.stringify(readback)}`);
}
const sample = readback.sample as ProofSampleRow[];
const publicSample = firstPage.items.map((item, index): ProofSampleRow => {
  const internalRow = sample[index];
  if (!internalRow) throw new Error(`Public API returned an unexpected row at rank ${item.rank}`);
  return {
    rank: item.rank,
    id: item.id,
    lane: item.lane,
    publisherKey: internalRow.publisherKey,
    upstreamRank: internalRow.upstreamRank,
    metrics: item.metrics,
  };
});
if (
  JSON.stringify(
    publicSample.map(({ rank, id, lane, metrics }) => ({ rank, id, lane, metrics })),
  ) !== JSON.stringify(sample.map(({ rank, id, lane, metrics }) => ({ rank, id, lane, metrics })))
) {
  throw new Error("Public API first-page fields differ from the owned snapshot readback");
}
const assertions = assertFirstPageContract(publicSample);
const materializedSample = materialization.sample as Array<{ id: string }>;
if (
  JSON.stringify(materializedSample.map((row) => row.id)) !== JSON.stringify(orderedIds(firstPage))
) {
  throw new Error("Public API first page differs from the regenerated materialization sample");
}

const proof = {
  generatedAt: new Date().toISOString(),
  target: {
    environment: "permanent Test",
    deploySha,
    siteUrl,
    convexDeployment: "academic-chihuahua-392",
  },
  materialization: {
    snapshotId,
    durationMs: materialization.durationMs,
    totalItems: materialization.totalItems,
    sourceCounts: materialization.sourceCounts,
    operations: materialization.operations,
    regeneratedFirst20: materializedSample,
  },
  publicApi: {
    samples: SAMPLE_COUNT,
    latency: latencySummary(firstSamples.map((sampleResult) => sampleResult.elapsedMs)),
    snapshotCursor: firstPage.snapshotCursor,
    generatedAt: firstPage.generatedAt,
    windowHours: firstPage.windowHours,
    rankingVersion: firstPage.rankingVersion,
    totalItems: firstPage.totalItems,
    pages,
    first20: firstPage.items,
  },
  assertions: {
    ...assertions,
    stableSnapshot: true,
    stableCursor: true,
    stableOrder: true,
    completePagination: true,
    duplicateIdentities: 0,
    lifetimeMetricsLabeled: true,
    skillsShTrending24hInstalls: assertions.skillsShUpstreamRanks.every(
      (_, index) =>
        publicSample.filter((row) => row.lane === "skills-sh-trending")[index]?.metrics
          .trending24hInstalls === null,
    )
      ? null
      : "unexpected-non-null",
  },
  readback,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outputPath: OUTPUT_PATH, snapshotId }));
