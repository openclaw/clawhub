import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

export const CANONICAL_TRENDING_RANKING_VERSION = "skills-trending-v3";
export const CANONICAL_TRENDING_WINDOW_HOURS = 24;
export const CANONICAL_TRENDING_FIRST_PAGE_SIZE = 20;
export const CANONICAL_TRENDING_PUBLISHER_CAP = 2;
export const CANONICAL_TRENDING_LANE_LIMIT = 1_000;

export function isFreshExternalTrendingRun(
  run: { runId: string | null; completedAt: number | null },
  now: number,
  maxAgeMs: number,
) {
  return Boolean(
    run.runId && run.completedAt !== null && run.completedAt > now - Math.max(0, maxAgeMs),
  );
}

const canonicalTrendingUpstreamScannerValidator = v.object({
  status: v.string(),
  sourceCheckedAt: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
});

export const canonicalTrendingCardValidator = v.object({
  id: v.string(),
  source: v.union(v.literal("clawhub"), v.literal("skills-sh")),
  slug: v.string(),
  displayName: v.string(),
  summary: v.union(v.string(), v.null()),
  canonicalUrl: v.string(),
  links: v.object({
    canonical: v.string(),
    source: v.union(v.string(), v.null()),
  }),
  publisher: v.union(
    v.object({
      kind: v.union(v.literal("user"), v.literal("org")),
      handle: v.union(v.string(), v.null()),
      displayName: v.union(v.string(), v.null()),
      image: v.union(v.string(), v.null()),
      official: v.boolean(),
    }),
    v.null(),
  ),
  official: v.boolean(),
  featured: v.boolean(),
  install: v.object({
    kind: v.union(v.literal("clawhub"), v.literal("github"), v.literal("skills-sh")),
    reference: v.string(),
    sourceUrl: v.union(v.string(), v.null()),
  }),
  sourceIdentity: v.object({
    id: v.string(),
    owner: v.union(v.string(), v.null()),
    repo: v.union(v.string(), v.null()),
    host: v.union(v.string(), v.null()),
    lifetimeInstalls: v.union(v.number(), v.null()),
  }),
  trust: v.object({
    visibility: v.literal("public"),
    installability: v.literal("installable"),
    clawHubVerdict: v.union(v.string(), v.null()),
    upstreamScanners: v.union(
      v.object({
        genAgentTrustHub: canonicalTrendingUpstreamScannerValidator,
        socket: canonicalTrendingUpstreamScannerValidator,
        snyk: canonicalTrendingUpstreamScannerValidator,
      }),
      v.null(),
    ),
    sourceFreshness: v.union(v.literal("native"), v.literal("observed-only")),
  }),
  metrics: v.object({
    // Optional only so snapshots materialized before this field landed remain readable
    // until the next hourly materialization replaces them.
    trending24hDownloads: v.optional(v.union(v.number(), v.null())),
    trending24hInstalls: v.union(v.number(), v.null()),
    trending24hBookmarks: v.union(v.number(), v.null()),
    lifetimeInstalls: v.union(v.number(), v.null()),
    lifetimeInstallsPeriod: v.literal("lifetime"),
    updatedAt: v.number(),
  }),
});

export const canonicalTrendingSourceRefValidator = v.union(
  v.object({ kind: v.literal("clawhub"), skillId: v.id("skills") }),
  v.object({ kind: v.literal("skills-sh"), externalId: v.string() }),
);

export type CanonicalTrendingCard = Infer<typeof canonicalTrendingCardValidator>;

export type CanonicalTrendingMaterializationCandidate = CanonicalTrendingCandidate & {
  card: CanonicalTrendingCard;
  sourceRef: Infer<typeof canonicalTrendingSourceRefValidator>;
};

type NativeTrendingDigest = Pick<
  Doc<"skillSearchDigest">,
  | "skillId"
  | "slug"
  | "displayName"
  | "summary"
  | "ownerUserId"
  | "ownerPublisherId"
  | "ownerHandle"
  | "ownerKind"
  | "ownerName"
  | "ownerDisplayName"
  | "ownerImage"
  | "badges"
  | "installKind"
  | "githubScanStatus"
  | "moderationVerdict"
  | "statsInstallsAllTime"
  | "stats"
  | "createdAt"
  | "updatedAt"
>;

type ExternalTrendingDigest = Pick<
  Doc<"skillsShMirrorDigests">,
  | "externalId"
  | "owner"
  | "repo"
  | "sourceHost"
  | "slug"
  | "displayName"
  | "searchSummary"
  | "sourceUrl"
  | "upstreamInstalls"
  | "trendingRank"
  | "trendingLifetimeInstalls"
  | "trendingObservedAt"
  | "upstreamScanners"
  | "firstObservedAt"
  | "lastObservedAt"
>;

export function buildNativeCanonicalTrendingCandidate(
  digest: NativeTrendingDigest,
  usage: { downloads: number; installs: number; bookmarks: number; updatedAt: number },
): CanonicalTrendingMaterializationCandidate | null {
  const ownerHandle = digest.ownerHandle?.trim();
  if (!ownerHandle) return null;
  const official = Boolean(digest.badges?.official);
  const canonicalUrl = `/${encodeURIComponent(ownerHandle)}/skills/${encodeURIComponent(digest.slug)}`;
  const identity = `clawhub:${String(digest.skillId)}`;
  const lifetimeInstalls = digest.statsInstallsAllTime ?? digest.stats.installsAllTime ?? null;
  return {
    identity,
    lane: "clawhub-trending",
    publisherKey: String(digest.ownerPublisherId ?? digest.ownerUserId),
    installs24h: Math.max(0, usage.installs),
    bookmarks24h: Math.max(0, usage.bookmarks),
    createdAt: digest.createdAt,
    updatedAt: digest.updatedAt,
    upstreamRank: null,
    sourceRef: { kind: "clawhub", skillId: digest.skillId },
    card: {
      id: identity,
      source: "clawhub",
      slug: digest.slug,
      displayName: digest.displayName,
      summary: digest.summary ?? null,
      canonicalUrl,
      links: { canonical: canonicalUrl, source: null },
      publisher: {
        kind: digest.ownerKind ?? "user",
        handle: ownerHandle,
        displayName: digest.ownerDisplayName ?? digest.ownerName ?? ownerHandle,
        image: digest.ownerImage ?? null,
        official,
      },
      official,
      featured: Boolean(digest.badges?.highlighted),
      install: {
        kind: digest.installKind === "github" ? "github" : "clawhub",
        reference: `${ownerHandle}/${digest.slug}`,
        sourceUrl: null,
      },
      sourceIdentity: {
        id: String(digest.skillId),
        owner: ownerHandle,
        repo: null,
        host: null,
        lifetimeInstalls,
      },
      trust: {
        visibility: "public",
        installability: "installable",
        clawHubVerdict: digest.githubScanStatus ?? digest.moderationVerdict ?? null,
        upstreamScanners: null,
        sourceFreshness: "native",
      },
      metrics: {
        trending24hDownloads: Math.max(0, usage.downloads),
        trending24hInstalls: Math.max(0, usage.installs),
        trending24hBookmarks: Math.max(0, usage.bookmarks),
        lifetimeInstalls,
        lifetimeInstallsPeriod: "lifetime",
        updatedAt: usage.updatedAt,
      },
    },
  };
}

export function buildExternalCanonicalTrendingCandidate(
  digest: ExternalTrendingDigest,
): CanonicalTrendingMaterializationCandidate | null {
  if (!Number.isSafeInteger(digest.trendingRank) || (digest.trendingRank ?? 0) < 1) return null;
  const encodedIdentity = digest.externalId
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const canonicalUrl = `/skills-sh/${encodedIdentity}`;
  const identity = `skills-sh:${digest.externalId}`;
  const lifetimeInstalls = digest.trendingLifetimeInstalls ?? digest.upstreamInstalls;
  return {
    identity,
    lane: "skills-sh-trending",
    publisherKey: digest.owner ?? digest.sourceHost ?? digest.externalId,
    installs24h: 0,
    bookmarks24h: 0,
    createdAt: digest.firstObservedAt,
    updatedAt: digest.trendingObservedAt ?? digest.lastObservedAt,
    upstreamRank: digest.trendingRank ?? null,
    sourceRef: { kind: "skills-sh", externalId: digest.externalId },
    card: {
      id: identity,
      source: "skills-sh",
      slug: digest.slug,
      displayName: digest.displayName,
      summary: digest.searchSummary ?? null,
      canonicalUrl,
      links: { canonical: canonicalUrl, source: digest.sourceUrl },
      publisher: null,
      official: false,
      featured: false,
      install: {
        kind: "skills-sh",
        reference: identity,
        sourceUrl: digest.sourceUrl,
      },
      sourceIdentity: {
        id: digest.externalId,
        owner: digest.owner ?? null,
        repo: digest.repo ?? null,
        host: digest.sourceHost ?? null,
        lifetimeInstalls,
      },
      trust: {
        visibility: "public",
        installability: "installable",
        clawHubVerdict: null,
        upstreamScanners: digest.upstreamScanners,
        sourceFreshness: "observed-only",
      },
      metrics: {
        trending24hDownloads: null,
        trending24hInstalls: null,
        trending24hBookmarks: null,
        lifetimeInstalls,
        lifetimeInstallsPeriod: "lifetime",
        updatedAt: digest.trendingObservedAt ?? digest.lastObservedAt,
      },
    },
  };
}

export type CanonicalTrendingLane = "clawhub-trending" | "clawhub-rising" | "skills-sh-trending";

export type CanonicalTrendingCandidate = {
  identity: string;
  lane: CanonicalTrendingLane;
  publisherKey: string;
  installs24h: number;
  bookmarks24h: number;
  createdAt: number;
  updatedAt: number;
  upstreamRank: number | null;
};

export type CanonicalTrendingPools<T extends CanonicalTrendingCandidate> = {
  clawhubTrending: T[];
  clawhubRising: T[];
  skillsShTrending: T[];
};

const WEIGHTED_CYCLE: CanonicalTrendingLane[] = [
  "clawhub-trending",
  "skills-sh-trending",
  "clawhub-rising",
  "clawhub-trending",
  "skills-sh-trending",
];

const SLOT_FALLBACKS: Record<CanonicalTrendingLane, CanonicalTrendingLane[]> = {
  "clawhub-trending": ["clawhub-trending", "skills-sh-trending", "clawhub-rising"],
  "clawhub-rising": ["clawhub-rising", "clawhub-trending", "skills-sh-trending"],
  "skills-sh-trending": ["skills-sh-trending", "clawhub-trending", "clawhub-rising"],
};

type PoolState<T> = {
  queue: T[];
  deferred: T[];
};

function compareNumberDesc(left: number, right: number) {
  return right - left;
}

function compareIdentity(left: CanonicalTrendingCandidate, right: CanonicalTrendingCandidate) {
  return left.identity.localeCompare(right.identity);
}

function compareCanonicalTrendingLaneCandidates(
  lane: CanonicalTrendingLane,
  left: CanonicalTrendingCandidate,
  right: CanonicalTrendingCandidate,
) {
  if (lane === "skills-sh-trending") {
    return (
      (left.upstreamRank ?? Number.MAX_SAFE_INTEGER) -
        (right.upstreamRank ?? Number.MAX_SAFE_INTEGER) || compareIdentity(left, right)
    );
  }
  return (
    compareNumberDesc(left.installs24h, right.installs24h) ||
    compareNumberDesc(left.bookmarks24h, right.bookmarks24h) ||
    compareNumberDesc(
      lane === "clawhub-rising" ? left.createdAt : left.updatedAt,
      lane === "clawhub-rising" ? right.createdAt : right.updatedAt,
    ) ||
    compareIdentity(left, right)
  );
}

export function retainTopCanonicalTrendingCandidates<T extends CanonicalTrendingCandidate>(
  candidates: readonly T[],
  lane: CanonicalTrendingLane,
  limit = CANONICAL_TRENDING_LANE_LIMIT,
  diversity?: { size: number; publisherCap: number },
) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Invalid canonical Trending lane limit");
  }
  const sorted = [...candidates].sort((left, right) =>
    compareCanonicalTrendingLaneCandidates(lane, left, right),
  );
  const leaders = sorted.slice(0, limit);
  if (!diversity) return leaders;
  if (
    !Number.isSafeInteger(diversity.size) ||
    diversity.size < 1 ||
    !Number.isSafeInteger(diversity.publisherCap) ||
    diversity.publisherCap < 1
  ) {
    throw new Error("Invalid canonical Trending diversity reserve");
  }
  const publisherCounts = new Map<string, number>();
  const reserve: T[] = [];
  for (const candidate of sorted) {
    const publisherCount = publisherCounts.get(candidate.publisherKey) ?? 0;
    if (publisherCount >= diversity.publisherCap) continue;
    publisherCounts.set(candidate.publisherKey, publisherCount + 1);
    reserve.push(candidate);
    if (reserve.length === diversity.size) break;
  }
  const retainedByIdentity = new Map(leaders.map((candidate) => [candidate.identity, candidate]));
  for (const candidate of reserve) retainedByIdentity.set(candidate.identity, candidate);
  return [...retainedByIdentity.values()].sort((left, right) =>
    compareCanonicalTrendingLaneCandidates(lane, left, right),
  );
}

export function sortCanonicalTrendingPools<T extends CanonicalTrendingCandidate>(
  pools: CanonicalTrendingPools<T>,
): CanonicalTrendingPools<T> {
  return {
    clawhubTrending: [...pools.clawhubTrending].sort((left, right) =>
      compareCanonicalTrendingLaneCandidates("clawhub-trending", left, right),
    ),
    clawhubRising: [...pools.clawhubRising].sort((left, right) =>
      compareCanonicalTrendingLaneCandidates("clawhub-rising", left, right),
    ),
    skillsShTrending: [...pools.skillsShTrending].sort((left, right) =>
      compareCanonicalTrendingLaneCandidates("skills-sh-trending", left, right),
    ),
  };
}

export function blendCanonicalTrendingPools<T extends CanonicalTrendingCandidate>(
  input: CanonicalTrendingPools<T>,
  options: {
    firstPageSize?: number;
    publisherCap?: number;
  } = {},
) {
  const firstPageSize = options.firstPageSize ?? CANONICAL_TRENDING_FIRST_PAGE_SIZE;
  const publisherCap = options.publisherCap ?? CANONICAL_TRENDING_PUBLISHER_CAP;
  const sorted = sortCanonicalTrendingPools(input);
  const pools: Record<CanonicalTrendingLane, PoolState<T>> = {
    "clawhub-trending": { queue: sorted.clawhubTrending, deferred: [] },
    "clawhub-rising": { queue: sorted.clawhubRising, deferred: [] },
    "skills-sh-trending": { queue: sorted.skillsShTrending, deferred: [] },
  };
  const publisherCounts = new Map<string, number>();
  const seen = new Set<string>();
  const result: T[] = [];
  let cycleIndex = 0;
  let capReleased = firstPageSize === 0;

  const releaseDeferred = () => {
    if (capReleased) return;
    capReleased = true;
    for (const pool of Object.values(pools)) {
      pool.queue = [...pool.deferred, ...pool.queue];
      pool.deferred = [];
    }
  };

  const takeFromLane = (lane: CanonicalTrendingLane) => {
    const pool = pools[lane];
    while (pool.queue.length > 0) {
      const next = pool.queue.shift()!;
      if (seen.has(next.identity)) continue;
      if (!capReleased && (publisherCounts.get(next.publisherKey) ?? 0) >= publisherCap) {
        pool.deferred.push(next);
        continue;
      }
      return next;
    }
    return null;
  };

  while (true) {
    if (!capReleased && result.length >= firstPageSize) releaseDeferred();

    const preferredLane = WEIGHTED_CYCLE[cycleIndex % WEIGHTED_CYCLE.length];
    cycleIndex += 1;
    let next: T | null = null;
    for (const lane of SLOT_FALLBACKS[preferredLane]) {
      next = takeFromLane(lane);
      if (next) break;
    }

    if (!next) {
      const deferredCount = Object.values(pools).reduce(
        (total, pool) => total + pool.deferred.length,
        0,
      );
      if (!capReleased && deferredCount > 0) {
        // A complete feed and a strict first-page cap cannot both be satisfied
        // when every remaining row belongs to an already-capped publisher.
        // Preserve the cap while alternatives exist, then release deterministically.
        releaseDeferred();
        continue;
      }
      break;
    }

    seen.add(next.identity);
    publisherCounts.set(next.publisherKey, (publisherCounts.get(next.publisherKey) ?? 0) + 1);
    result.push(next);
  }

  return result;
}

export type CanonicalTrendingCursor = {
  snapshotId: string;
  offset: number;
  emitted?: number;
  skillsShPublic?: boolean;
};

export function encodeCanonicalTrendingCursor(cursor: CanonicalTrendingCursor) {
  if (!cursor.snapshotId || !/^[A-Za-z0-9:_-]+$/.test(cursor.snapshotId)) {
    throw new Error("Invalid snapshot ID");
  }
  if (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0) {
    throw new Error("Invalid cursor offset");
  }
  if (
    cursor.emitted !== undefined &&
    (!Number.isSafeInteger(cursor.emitted) || cursor.emitted < 0 || cursor.emitted > cursor.offset)
  ) {
    throw new Error("Invalid cursor emitted count");
  }
  return btoa(
    JSON.stringify({
      v: 1,
      s: cursor.snapshotId,
      o: cursor.offset,
      ...(cursor.emitted !== undefined ? { e: cursor.emitted } : {}),
      ...(cursor.skillsShPublic !== undefined ? { p: cursor.skillsShPublic } : {}),
    }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeCanonicalTrendingCursor(value: string): CanonicalTrendingCursor {
  try {
    const padded = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as {
      v?: unknown;
      s?: unknown;
      o?: unknown;
      e?: unknown;
      p?: unknown;
    };
    if (
      parsed.v !== 1 ||
      typeof parsed.s !== "string" ||
      !/^[A-Za-z0-9:_-]+$/.test(parsed.s) ||
      !Number.isSafeInteger(parsed.o) ||
      (parsed.o as number) < 0 ||
      (parsed.e !== undefined &&
        (!Number.isSafeInteger(parsed.e) ||
          (parsed.e as number) < 0 ||
          (parsed.e as number) > (parsed.o as number))) ||
      (parsed.p !== undefined && typeof parsed.p !== "boolean")
    ) {
      throw new Error("invalid");
    }
    return {
      snapshotId: parsed.s,
      offset: parsed.o as number,
      ...(parsed.e !== undefined ? { emitted: parsed.e as number } : {}),
      ...(parsed.p !== undefined ? { skillsShPublic: parsed.p as boolean } : {}),
    };
  } catch {
    throw new Error("Invalid cursor format");
  }
}
