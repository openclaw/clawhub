#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fetchSkillsShCatalogDetail,
  fetchSkillsShCatalogPage,
  searchSkillsShCatalog,
  type SkillsShCatalogListRow,
} from "../../server/skillsShCatalogSource";

const SNAPSHOT_ID = "skills-sh-500-2026-07-21";
const ROW_LIMIT = 500;
const DETAIL_CANDIDATE_LIMIT = 525;
const DETAIL_CONCURRENCY = 8;
const OUTPUT_PATH = resolve("convex/fixtures/skills-sh-500-2026-07-21.json");
const REQUIRED_COLLISION_IDS = [
  "anthropics/skills/frontend-design",
  "anthropics/claude-code/frontend-design",
] as const;

type FrozenRow = {
  externalId: string;
  githubOwnerId: number;
  owner: string;
  repo: string;
  slug: string;
  displayName: string;
  sourceUrl: string;
  githubRepoUrl: string;
  sourceContentHash: string;
  installs: number;
};

function isGitHubRow(row: SkillsShCatalogListRow) {
  const normalizedSource = row.source.trim().toLowerCase();
  const normalizedSlug = row.slug.trim().toLowerCase();
  return (
    row.sourceType === "github" &&
    normalizedSource.split("/").length === 2 &&
    /^[a-z0-9][a-z0-9-]*$/.test(normalizedSlug) &&
    row.id.trim().toLowerCase() === `${normalizedSource}/${normalizedSlug}`
  );
}

function normalizeRow(row: SkillsShCatalogListRow) {
  const [owner = "", repo = ""] = row.source.split("/");
  return {
    ...row,
    id: `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}/${row.slug
      .trim()
      .toLowerCase()}`,
    owner: owner.trim().toLowerCase(),
    repo: repo.trim().toLowerCase(),
    slug: row.slug.trim().toLowerCase(),
  };
}

function readGitHubOwnerId(owner: string) {
  const result = spawnSync("gh", ["api", `users/${owner}`, "--jq", ".id"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`GitHub owner lookup failed for ${owner}`);
  }
  const id = Number(result.stdout.trim());
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`GitHub owner lookup returned an invalid id for ${owner}`);
  }
  return id;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = Array.from<R>({ length: values.length });
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function main() {
  const startedAt = Date.now();
  const candidates = new Map<string, ReturnType<typeof normalizeRow>>();
  let listFetches = 0;
  for (let page = 0; candidates.size < ROW_LIMIT + 100; page += 1) {
    const response = await fetchSkillsShCatalogPage({ page, perPage: ROW_LIMIT });
    listFetches += 1;
    for (const row of response.data) {
      if (!isGitHubRow(row)) continue;
      const normalized = normalizeRow(row);
      candidates.set(normalized.id, normalized);
    }
    if (!response.pagination.hasMore) break;
  }

  const nvidia = await searchSkillsShCatalog({
    query: "nvidia",
    owner: "nvidia",
    limit: 200,
  });
  const nvidiaRows = nvidia.data
    .filter(isGitHubRow)
    .map(normalizeRow)
    .filter((row) => row.owner === "nvidia")
    .slice(0, 10);

  const requiredIds = new Set<string>([
    ...REQUIRED_COLLISION_IDS,
    ...nvidiaRows.map((row) => row.id),
  ]);
  for (const row of nvidiaRows) candidates.set(row.id, row);
  for (const id of requiredIds) {
    if (!candidates.has(id)) {
      throw new Error(`Required skills.sh fixture row is missing: ${id}`);
    }
  }

  const detailCandidates = [
    ...Array.from(requiredIds, (id) => candidates.get(id)!),
    ...Array.from(candidates.values()).filter((row) => !requiredIds.has(row.id)),
  ].slice(0, DETAIL_CANDIDATE_LIMIT);
  if (detailCandidates.length !== DETAIL_CANDIDATE_LIMIT) {
    throw new Error(
      `Expected ${DETAIL_CANDIDATE_LIMIT} detail candidates, received ${detailCandidates.length}`,
    );
  }

  const details = await mapWithConcurrency(
    detailCandidates,
    DETAIL_CONCURRENCY,
    async (row) => await fetchSkillsShCatalogDetail(row.id),
  );

  const selected = detailCandidates
    .map((row, index) => ({ row, detail: details[index] }))
    .filter(
      (
        candidate,
      ): candidate is {
        row: ReturnType<typeof normalizeRow>;
        detail: NonNullable<(typeof details)[number]>;
      } =>
        candidate.detail !== null &&
        candidate.detail.id.toLowerCase() === candidate.row.id &&
        /^[a-f0-9]{64}$/i.test(candidate.detail.hash),
    )
    .slice(0, ROW_LIMIT);
  if (selected.length !== ROW_LIMIT) {
    throw new Error(`Only ${selected.length} rows had canonical ids and exact content hashes`);
  }
  for (const id of requiredIds) {
    if (!selected.some((candidate) => candidate.row.id === id)) {
      throw new Error(`Required skills.sh fixture row lacks an exact detail hash: ${id}`);
    }
  }

  const owners = Array.from(new Set(selected.map(({ row }) => row.owner))).sort();
  const ownerIds = new Map(owners.map((owner) => [owner, readGitHubOwnerId(owner)] as const));
  const rows: FrozenRow[] = selected.map(({ row, detail }) => {
    return {
      externalId: row.id,
      githubOwnerId: ownerIds.get(row.owner)!,
      owner: row.owner,
      repo: row.repo,
      slug: row.slug,
      displayName: row.name.trim() || row.slug,
      sourceUrl: row.url,
      githubRepoUrl: row.installUrl ?? `https://github.com/${row.owner}/${row.repo}`,
      sourceContentHash: detail.hash.toLowerCase(),
      installs: row.installs,
    };
  });

  const capturedAt = new Date().toISOString();
  const payload = {
    snapshotId: SNAPSHOT_ID,
    capturedAt,
    source: {
      project: "openclaw-foundation/clawhub",
      endpoint: "https://skills.sh/api/v1/skills",
      authentication: "vercel-oidc",
      requestedRows: ROW_LIMIT,
    },
    selection: {
      rows: rows.length,
      nvidiaRows: rows.filter((row) => row.owner === "nvidia").length,
      requiredCollisionIds: REQUIRED_COLLISION_IDS,
    },
    captureMetrics: {
      runtimeMs: Date.now() - startedAt,
      skillsShFetches: listFetches + 1 + details.length,
      githubOwnerFetches: owners.length,
      listFetches,
      searchFetches: 1,
      detailFetches: details.length,
    },
    rows,
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    JSON.stringify({
      outputPath: OUTPUT_PATH,
      snapshotId: SNAPSHOT_ID,
      rows: rows.length,
      nvidiaRows: payload.selection.nvidiaRows,
      collisionIds: REQUIRED_COLLISION_IDS,
      captureMetrics: payload.captureMetrics,
    }),
  );
}

await main();
