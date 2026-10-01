#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { CANONICAL_SKILL_SEARCH_BOUNDS } from "../../convex/lib/canonicalSkillSearchBounds";
import {
  assertCanonicalSearchResults,
  assertStableOrder,
  latencySummary,
  orderedResultIds,
  type CanonicalSearchResult,
} from "./proof-contract";

const OUTPUT_PATH = resolve("proof/claw-577/canonical-search-test-proof.json");
const EXTERNAL_ID = "clawhub-test/claw-577/search-popularity-decoy";
const SAMPLE_COUNT = 3;
const LIMIT = 100;

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const deploySha = requireEnv("DEPLOY_SHA");
const siteUrl = requireEnv("TEST_SITE_URL").replace(/\/$/, "");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

type TimedResults = { elapsedMs: number; results: CanonicalSearchResult[] };
const execFileAsync = promisify(execFile);

async function fetchSearch(path: string, query: string): Promise<TimedResults> {
  const url = new URL(path, siteUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(LIMIT));
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
  });
  const elapsedMs = performance.now() - startedAt;
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  const payload = JSON.parse(text) as { results?: unknown };
  if (!Array.isArray(payload.results)) throw new Error(`${path} response is missing results`);
  return { elapsedMs, results: assertCanonicalSearchResults(payload.results) };
}

async function runActionSearch(query: string): Promise<TimedResults> {
  const startedAt = performance.now();
  const { stdout } = await execFileAsync(
    "bunx",
    ["convex", "run", "--no-push", "search:searchSkills", JSON.stringify({ query, limit: LIMIT })],
    { env: process.env, maxBuffer: 16 * 1024 * 1024 },
  );
  const results = JSON.parse(stdout.trim()) as unknown;
  if (!Array.isArray(results)) throw new Error("search action response is missing results");
  return {
    elapsedMs: performance.now() - startedAt,
    results: assertCanonicalSearchResults(results),
  };
}

async function sampleSurface(load: () => Promise<TimedResults>) {
  const samples: TimedResults[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) samples.push(await load());
  assertStableOrder(samples.map((sample) => orderedResultIds(sample.results)));
  return samples;
}

async function proveCase(name: string, query: string) {
  const v1 = await sampleSurface(() => fetchSearch("/api/v1/search", query));
  const legacy = await sampleSurface(() => fetchSearch("/api/search", query));
  const action = await sampleSurface(() => runActionSearch(query));
  const orders = [
    ...v1.map((sample) => orderedResultIds(sample.results)),
    ...legacy.map((sample) => orderedResultIds(sample.results)),
    ...action.map((sample) => orderedResultIds(sample.results)),
  ];
  assertStableOrder(orders);
  return {
    name,
    query,
    orderedIds: orders[0],
    results: v1[0]?.results ?? [],
    latency: {
      apiV1: latencySummary(v1.map((sample) => sample.elapsedMs)),
      compatibilityApi: latencySummary(legacy.map((sample) => sample.elapsedMs)),
      webAction: latencySummary(action.map((sample) => sample.elapsedMs)),
    },
  };
}

await fetchSearch("/api/v1/search", "gifgrep");
const discovery = await fetchSearch("/api/v1/search", "gifgrep");
const nativeGifgrep = discovery.results.find(
  (result) => result.source === "clawhub" && result.slug === "gifgrep",
);
if (!nativeGifgrep || typeof nativeGifgrep.ownerHandle !== "string") {
  throw new Error("permanent Test is missing the stable native gifgrep fixture");
}

const cases = [];
cases.push(await proveCase("exact-native-and-irrelevant-popularity", "gifgrep"));
cases.push(await proveCase("owner-qualified-native", `${nativeGifgrep.ownerHandle}/gifgrep`));
cases.push(await proveCase("exact-external", `skills-sh/${EXTERNAL_ID}`));
cases.push(await proveCase("natural-language-intent", "stock price"));

const exact = cases[0];
const exactFirst = exact?.results[0];
if (exactFirst?.id !== nativeGifgrep.id) {
  throw new Error("exact native match did not remain first");
}
const decoyIndex = exact.results.findIndex((result) => result.id === `skills-sh:${EXTERNAL_ID}`);
if (decoyIndex <= 0)
  throw new Error("9M-lifetime external decoy did not remain below exact native");
const decoy = exact.results[decoyIndex];
const decoyIdentity = decoy?.sourceIdentity as Record<string, unknown> | undefined;
if (decoyIdentity?.lifetimeInstalls !== 9_000_000) {
  throw new Error("external popularity decoy lifetime install count is missing");
}
if (cases[1]?.results[0]?.id !== nativeGifgrep.id) {
  throw new Error("owner-qualified native lookup did not preserve exact identity order");
}
if (cases[2]?.results[0]?.id !== `skills-sh:${EXTERNAL_ID}`) {
  throw new Error("owner-qualified external lookup did not return the exact external identity");
}
if ((cases[3]?.results.length ?? 0) === 0) {
  throw new Error("natural-language intent query returned no results");
}

const proof = {
  generatedAt: new Date().toISOString(),
  target: {
    environment: "permanent Test",
    deploySha,
    siteUrl,
    convexDeployment: "academic-chihuahua-392",
    productionWrites: 0,
    schedulesCreated: 0,
    scansPlanned: 0,
    scansAdmitted: 0,
    claimsCreated: 0,
  },
  contract: {
    samplesPerSurface: SAMPLE_COUNT,
    consumerSurfaces: ["api-v1-cli-openclaw", "compatibility-api", "clawhub-web-action"],
    costBounds: {
      ...CANONICAL_SKILL_SEARCH_BOUNDS,
      maximumExternalIndexedCandidates:
        CANONICAL_SKILL_SEARCH_BOUNDS.externalCandidateLimitPerIndex *
        CANONICAL_SKILL_SEARCH_BOUNDS.externalIndexedReadCount,
      measurement: "source-enforced candidate bounds; document-read counters are not exposed",
    },
    latencyPolicy: "observed median/p95 recorded; issue defines no numeric latency SLO",
  },
  fixture: {
    externalId: EXTERNAL_ID,
    lifetimeInstalls: 9_000_000,
    rankingWeight: 0,
  },
  cases,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outputPath: OUTPUT_PATH, cases: cases.length }));
