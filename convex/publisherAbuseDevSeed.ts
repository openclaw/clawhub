import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
// DEV-ONLY seed: use the un-wrapped mutation builder (not convex/functions.ts) so
// inserting/deleting demo rows does NOT fire table triggers. The users digest-sync
// trigger runs a paginated query, and Convex allows only one paginated query per
// mutation, so deleting several linked demo users through the wrapped builder fails.
// Demo rows have no real packages/skills, so skipping digest sync is correct here.
import { internalMutation } from "./_generated/server";
import { assertLocalDevSeedAllowed } from "./lib/devSeed";
import {
  computePublisherAbuseRawScore,
  DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
  PUBLISHER_ABUSE_MODEL_VERSION,
  type PublisherAbuseLabel,
} from "./lib/publisherAbuseScoring";

// DEV-ONLY seed for the publisher-abuse review dashboard. It inserts one
// completed score run plus a spread of synthetic scores/nominations so every
// dashboard tab renders with realistic rows. All synthetic rows use the
// "demo-" prefix on handle/ownerKey so `clearSeed` can remove them precisely.

const DEMO_HANDLE_PREFIX = "demo-abuse-pub-";
const DEMO_OWNER_KEY_PREFIX = "user:demo-";
const CLEAR_SEED_BATCH_SIZE = 100;

type TriageStatus =
  | "pending"
  | "reviewed_no_action"
  | "false_positive"
  | "needs_policy_discussion"
  | "candidate_for_future_action";

type SeedPublisher = {
  index: number;
  label: PublisherAbuseLabel;
  status: TriageStatus;
  zScore: number;
  publishedSkills: number;
  totalInstalls: number;
  totalStars: number;
  totalDownloads: number;
  reasonCodes: string[];
  notes?: string;
  // When true, also create an isolated demo user account and link it so the
  // inspector's "Ban user" action is enabled and exercisable in dev.
  linkUser?: boolean;
};

// Prod-scale synthetic distribution so every dashboard tab renders with realistic
// volume: 15 potential-ban candidates and 124 review nominations (both pending),
// plus a small resolved/pass set for the Resolved tab. Counts mirror the reported
// production review queue. Rows are deterministic (no randomness) so tests can
// assert the distribution and clearSeed stays reproducible.
const BAN_CANDIDATE_COUNT = 15;
const REVIEW_PENDING_COUNT = 124;

const BAN_CANDIDATE_REASON_CODES = [
  "high_catalog_volume",
  "extreme_volume_low_engagement",
  "low_installs_per_skill",
  "low_stars_per_skill",
  "low_downloads_per_skill",
];

const REVIEW_REASON_VARIANTS: string[][] = [
  ["high_catalog_volume", "low_installs_per_skill", "low_stars_per_skill"],
  ["high_catalog_volume", "low_installs_per_skill"],
  ["high_catalog_volume", "low_stars_per_skill", "low_downloads_per_skill"],
  ["high_catalog_volume", "low_installs_per_skill", "low_downloads_per_skill"],
];

// Resolved + pass anchors keep the Resolved tab populated and exercise the
// inspector's notes rendering. None link a demo user, so the only seeded demo
// users are the 15 pending ban candidates.
const RESOLVED_AND_PASS_PUBLISHERS: Array<Omit<SeedPublisher, "index">> = [
  {
    label: "potential_ban_candidate",
    status: "needs_policy_discussion",
    zScore: 2.75,
    publishedSkills: 2600,
    totalInstalls: 210,
    totalStars: 28,
    totalDownloads: 6400,
    reasonCodes: BAN_CANDIDATE_REASON_CODES,
    notes: "Escalated to policy: borderline catalog-stuffing pattern, awaiting decision.",
  },
  {
    label: "review",
    status: "false_positive",
    zScore: 1.8,
    publishedSkills: 340,
    totalInstalls: 520,
    totalStars: 40,
    totalDownloads: 48000,
    reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
    notes: "Confirmed legitimate bulk publisher; cleared after manual spot-check.",
  },
  {
    label: "review",
    status: "candidate_for_future_action",
    zScore: 2.0,
    publishedSkills: 480,
    totalInstalls: 360,
    totalStars: 17,
    totalDownloads: 29000,
    reasonCodes: ["high_catalog_volume", "low_installs_per_skill", "low_stars_per_skill"],
    notes: "Watchlist: revisit if catalog keeps growing without engagement.",
  },
  {
    label: "review",
    status: "reviewed_no_action",
    zScore: 1.6,
    publishedSkills: 290,
    totalInstalls: 470,
    totalStars: 33,
    totalDownloads: 31000,
    reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
    notes: "Reviewed: engagement within acceptable range for catalog size.",
  },
  {
    label: "pass",
    status: "reviewed_no_action",
    zScore: 0.4,
    publishedSkills: 120,
    totalInstalls: 9800,
    totalStars: 540,
    totalDownloads: 210000,
    reasonCodes: [],
    notes: "Healthy engagement per skill; no action needed.",
  },
  {
    label: "pass",
    status: "reviewed_no_action",
    zScore: 0.2,
    publishedSkills: 64,
    totalInstalls: 7200,
    totalStars: 410,
    totalDownloads: 150000,
    reasonCodes: [],
    notes: "Strong installs and stars per skill; clearly legitimate.",
  },
];

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

// Ban candidates carry the highest z-scores (3.9 → 2.55) and link demo users so
// the inspector ban action is exercisable; review nominations span the "on the
// brink" band (2.4 → 1.3). Metrics vary per row so the inspector looks realistic.
function buildSeedPublishers(): SeedPublisher[] {
  const publishers: SeedPublisher[] = [];
  let index = 1;

  for (let i = 0; i < BAN_CANDIDATE_COUNT; i += 1) {
    const fraction = i / (BAN_CANDIDATE_COUNT - 1);
    publishers.push({
      index,
      label: "potential_ban_candidate",
      status: "pending",
      zScore: roundToTwo(3.9 - fraction * 1.35),
      publishedSkills: 4200 - i * 170,
      totalInstalls: 130 + (i % 6) * 16,
      totalStars: 15 + (i % 8) * 2,
      totalDownloads: 9800 - i * 300,
      reasonCodes: BAN_CANDIDATE_REASON_CODES,
      linkUser: true,
    });
    index += 1;
  }

  for (let i = 0; i < REVIEW_PENDING_COUNT; i += 1) {
    const fraction = i / (REVIEW_PENDING_COUNT - 1);
    publishers.push({
      index,
      label: "review",
      status: "pending",
      zScore: roundToTwo(2.4 - fraction * 1.1),
      publishedSkills: 650 - i * 3,
      totalInstalls: 300 + (i % 9) * 30,
      totalStars: 14 + (i % 11) * 3,
      totalDownloads: 26000 + (i % 13) * 1500,
      reasonCodes: REVIEW_REASON_VARIANTS[i % REVIEW_REASON_VARIANTS.length],
    });
    index += 1;
  }

  for (const publisher of RESOLVED_AND_PASS_PUBLISHERS) {
    publishers.push({ index, ...publisher });
    index += 1;
  }

  return publishers;
}

const SEED_PUBLISHERS: SeedPublisher[] = buildSeedPublishers();

const SCANNED_PUBLISHERS = 194_083;
const SCORED_PUBLISHERS = 10_349;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function paddedIndex(index: number): string {
  return index.toString().padStart(2, "0");
}

function isDemoHandle(handle: string): boolean {
  return handle.startsWith(DEMO_HANDLE_PREFIX);
}

function isDemoOwnerKey(ownerKey: string): boolean {
  return ownerKey.startsWith(DEMO_OWNER_KEY_PREFIX);
}

function demoHandle(index: number): string {
  return `${DEMO_HANDLE_PREFIX}${paddedIndex(index)}`;
}

function demoOwnerKey(index: number): string {
  return `${DEMO_OWNER_KEY_PREFIX}${paddedIndex(index)}`;
}

const DEMO_HANDLES = SEED_PUBLISHERS.map((publisher) => demoHandle(publisher.index));
const DEMO_OWNER_KEYS = SEED_PUBLISHERS.map((publisher) => demoOwnerKey(publisher.index));

type ClearSeedCtx = Pick<MutationCtx, "db">;
type ClearSeedResult = {
  runs: number;
  scores: number;
  nominations: number;
  events: number;
  users: number;
  hasMore: boolean;
};

export const seed = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ runId: Id<"publisherAbuseScoreRuns">; inserted: number }> => {
    assertLocalDevSeedAllowed("Publisher abuse");
    await clearDemoRows(ctx);

    const now = Date.now();
    const startedAt = now - 2 * HOUR_MS;
    const completedAt = now - HOUR_MS;

    const labelCounts: Record<PublisherAbuseLabel, number> = {
      pass: 0,
      review: 0,
      potential_ban_candidate: 0,
    };
    let nominatedPublishers = 0;
    let sumLogPressure = 0;
    let sumSquaredLogPressure = 0;
    for (const publisher of SEED_PUBLISHERS) {
      labelCounts[publisher.label] += 1;
      if (publisher.label !== "pass") nominatedPublishers += 1;
      const raw = computePublisherAbuseRawScore({
        ownerKey: demoOwnerKey(publisher.index),
        handleSnapshot: demoHandle(publisher.index),
        publishedSkills: publisher.publishedSkills,
        totalInstalls: publisher.totalInstalls,
        totalStars: publisher.totalStars,
        totalDownloads: publisher.totalDownloads,
      });
      sumLogPressure += raw.logPressure;
      sumSquaredLogPressure += raw.logPressure ** 2;
    }

    const meanLogPressure = sumLogPressure / SEED_PUBLISHERS.length;
    const variance = Math.max(
      0,
      sumSquaredLogPressure / SEED_PUBLISHERS.length - meanLogPressure ** 2,
    );
    const stdDevLogPressure = Math.sqrt(variance);

    const runId = await ctx.db.insert("publisherAbuseScoreRuns", {
      modelVersion: PUBLISHER_ABUSE_MODEL_VERSION,
      modelConfig: DEFAULT_PUBLISHER_ABUSE_MODEL_CONFIG,
      trigger: "manual",
      status: "completed",
      phase: "completed",
      startedAt,
      completedAt,
      updatedAt: completedAt,
      scannedPublishers: SCANNED_PUBLISHERS,
      scoredPublishers: SCORED_PUBLISHERS,
      finalizedScores: SCORED_PUBLISHERS,
      nominatedPublishers,
      passCount: labelCounts.pass,
      reviewCount: labelCounts.review,
      potentialBanCandidateCount: labelCounts.potential_ban_candidate,
      sumLogPressure,
      sumSquaredLogPressure,
      meanLogPressure,
      stdDevLogPressure,
    });

    let rank = 1;
    for (const publisher of SEED_PUBLISHERS) {
      const handle = demoHandle(publisher.index);
      const ownerKey = demoOwnerKey(publisher.index);
      const raw = computePublisherAbuseRawScore({
        ownerKey,
        handleSnapshot: handle,
        publishedSkills: publisher.publishedSkills,
        totalInstalls: publisher.totalInstalls,
        totalStars: publisher.totalStars,
        totalDownloads: publisher.totalDownloads,
      });

      const lastScoredAt = completedAt;
      const openedAt = completedAt;
      const reviewed = publisher.status !== "pending";
      const reviewedAt = reviewed ? completedAt + publisher.index * 60_000 : undefined;
      const updatedAt = reviewedAt ?? completedAt;

      const ownerUserId = publisher.linkUser
        ? await ctx.db.insert("users", {
            handle,
            name: `Demo Abuse Publisher ${paddedIndex(publisher.index)}`,
            role: "user",
            createdAt: now - DAY_MS,
            updatedAt: now - DAY_MS,
          })
        : undefined;

      const scoreId = await ctx.db.insert("publisherAbuseScores", {
        runId,
        ownerKey,
        ownerPublisherId: undefined,
        ownerUserId,
        handleSnapshot: handle,
        modelVersion: PUBLISHER_ABUSE_MODEL_VERSION,
        label: publisher.label,
        rank,
        pressure: raw.pressure,
        logPressure: raw.logPressure,
        zScore: publisher.zScore,
        publishedSkills: raw.publishedSkills,
        totalInstalls: raw.totalInstalls,
        totalStars: raw.totalStars,
        totalDownloads: raw.totalDownloads,
        installsPerSkill: raw.installsPerSkill,
        starsPerSkill: raw.starsPerSkill,
        downloadsPerSkill: raw.downloadsPerSkill,
        reasonCodes: publisher.reasonCodes,
        createdAt: now - DAY_MS,
      });
      rank += 1;

      await ctx.db.insert("publisherAbuseReviewNominations", {
        ownerKey,
        ownerPublisherId: undefined,
        ownerUserId,
        handleSnapshot: handle,
        latestScoreId: scoreId,
        modelVersion: PUBLISHER_ABUSE_MODEL_VERSION,
        label: publisher.label,
        status: publisher.status,
        openedAt,
        openedByRunId: runId,
        lastScoredAt,
        reviewedByUserId: undefined,
        reviewedAt,
        notes: publisher.notes,
        updatedAt,
      });
    }

    return { runId, inserted: SEED_PUBLISHERS.length };
  },
});

export const clearSeed = internalMutation({
  args: {},
  handler: async (ctx): Promise<ClearSeedResult> => {
    assertLocalDevSeedAllowed("Publisher abuse");
    return await clearDemoRows(ctx);
  },
});

async function clearDemoRows(ctx: ClearSeedCtx): Promise<ClearSeedResult> {
  let runs = 0;
  let scores = 0;
  let nominations = 0;
  let events = 0;
  let users = 0;
  let hasMore = false;

  const demoRunIds = new Set<Id<"publisherAbuseScoreRuns">>();
  for (const ownerKey of DEMO_OWNER_KEYS) {
    const page = await queryDemoScoresPage(ctx, ownerKey);
    hasMore ||= !page.isDone;
    for (const score of page.page) {
      if (!isDemoOwnerKey(score.ownerKey) && !isDemoHandle(score.handleSnapshot)) continue;
      demoRunIds.add(score.runId);
      await ctx.db.delete(score._id);
      scores += 1;
    }
  }

  for (const ownerKey of DEMO_OWNER_KEYS) {
    const page = await queryDemoNominationsPage(ctx, ownerKey);
    hasMore ||= !page.isDone;
    for (const nomination of page.page) {
      if (!isDemoOwnerKey(nomination.ownerKey) && !isDemoHandle(nomination.handleSnapshot)) {
        continue;
      }
      demoRunIds.add(nomination.openedByRunId);
      await ctx.db.delete(nomination._id);
      nominations += 1;
    }
  }

  for (const ownerKey of DEMO_OWNER_KEYS) {
    const page = await queryDemoEventsPage(ctx, ownerKey);
    hasMore ||= !page.isDone;
    for (const event of page.page) {
      if (!isDemoOwnerKey(event.ownerKey)) continue;
      await ctx.db.delete(event._id);
      events += 1;
    }
  }

  for (const runId of demoRunIds) {
    const run = await ctx.db.get(runId);
    if (!run) continue;
    await ctx.db.delete(runId);
    runs += 1;
  }

  for (const handle of DEMO_HANDLES) {
    const page = await queryDemoUsersPage(ctx, handle);
    hasMore ||= !page.isDone;
    for (const user of page.page) {
      if (!user.handle || !isDemoHandle(user.handle)) continue;
      await ctx.db.delete(user._id);
      users += 1;
    }
  }

  return { runs, scores, nominations, events, users, hasMore };
}

async function queryDemoScoresPage(
  ctx: ClearSeedCtx,
  ownerKey: string,
): Promise<{ page: Doc<"publisherAbuseScores">[]; isDone: boolean }> {
  const rows = await ctx.db
    .query("publisherAbuseScores")
    .withIndex("by_owner_key_and_created_at", (q) => q.eq("ownerKey", ownerKey))
    .take(CLEAR_SEED_BATCH_SIZE + 1);
  return {
    page: rows.slice(0, CLEAR_SEED_BATCH_SIZE),
    isDone: rows.length <= CLEAR_SEED_BATCH_SIZE,
  };
}

async function queryDemoNominationsPage(
  ctx: ClearSeedCtx,
  ownerKey: string,
): Promise<{ page: Doc<"publisherAbuseReviewNominations">[]; isDone: boolean }> {
  const rows = await ctx.db
    .query("publisherAbuseReviewNominations")
    .withIndex("by_owner_key_and_model_version", (q) => q.eq("ownerKey", ownerKey))
    .take(CLEAR_SEED_BATCH_SIZE + 1);
  return {
    page: rows.slice(0, CLEAR_SEED_BATCH_SIZE),
    isDone: rows.length <= CLEAR_SEED_BATCH_SIZE,
  };
}

async function queryDemoEventsPage(
  ctx: ClearSeedCtx,
  ownerKey: string,
): Promise<{ page: Doc<"publisherAbuseReviewEvents">[]; isDone: boolean }> {
  const rows = await ctx.db
    .query("publisherAbuseReviewEvents")
    .withIndex("by_owner_key_and_created_at", (q) => q.eq("ownerKey", ownerKey))
    .take(CLEAR_SEED_BATCH_SIZE + 1);
  return {
    page: rows.slice(0, CLEAR_SEED_BATCH_SIZE),
    isDone: rows.length <= CLEAR_SEED_BATCH_SIZE,
  };
}

async function queryDemoUsersPage(
  ctx: ClearSeedCtx,
  handle: string,
): Promise<{ page: Doc<"users">[]; isDone: boolean }> {
  const rows = await ctx.db
    .query("users")
    .withIndex("handle", (q) => q.eq("handle", handle))
    .take(CLEAR_SEED_BATCH_SIZE + 1);
  return {
    page: rows.slice(0, CLEAR_SEED_BATCH_SIZE),
    isDone: rows.length <= CLEAR_SEED_BATCH_SIZE,
  };
}
