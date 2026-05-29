import type { Id } from "./_generated/dataModel";
// DEV-ONLY seed: use the un-wrapped mutation builder (not convex/functions.ts) so
// inserting/deleting demo rows does NOT fire table triggers. The users digest-sync
// trigger runs a paginated query, and Convex allows only one paginated query per
// mutation, so deleting several linked demo users through the wrapped builder fails.
// Demo rows have no real packages/skills, so skipping digest sync is correct here.
import { mutation } from "./_generated/server";
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

// 4 ban candidates (pending, high zScore), 5 review (pending), 3 resolved.
const SEED_PUBLISHERS: SeedPublisher[] = [
  {
    index: 1,
    label: "potential_ban_candidate",
    status: "pending",
    zScore: 3.9,
    publishedSkills: 4200,
    totalInstalls: 168,
    totalStars: 21,
    totalDownloads: 9800,
    reasonCodes: [
      "high_catalog_volume",
      "extreme_volume_low_engagement",
      "low_installs_per_skill",
      "low_stars_per_skill",
      "low_downloads_per_skill",
    ],
    linkUser: true,
  },
  {
    index: 2,
    label: "potential_ban_candidate",
    status: "pending",
    zScore: 3.4,
    publishedSkills: 3100,
    totalInstalls: 142,
    totalStars: 18,
    totalDownloads: 7400,
    reasonCodes: [
      "high_catalog_volume",
      "extreme_volume_low_engagement",
      "low_installs_per_skill",
      "low_stars_per_skill",
      "low_downloads_per_skill",
    ],
  },
  {
    index: 3,
    label: "potential_ban_candidate",
    status: "pending",
    zScore: 2.9,
    publishedSkills: 2400,
    totalInstalls: 190,
    totalStars: 26,
    totalDownloads: 6100,
    reasonCodes: [
      "high_catalog_volume",
      "extreme_volume_low_engagement",
      "low_installs_per_skill",
      "low_stars_per_skill",
      "low_downloads_per_skill",
    ],
  },
  {
    index: 4,
    label: "potential_ban_candidate",
    status: "pending",
    zScore: 2.6,
    publishedSkills: 1800,
    totalInstalls: 160,
    totalStars: 24,
    totalDownloads: 5200,
    reasonCodes: [
      "high_catalog_volume",
      "extreme_volume_low_engagement",
      "low_installs_per_skill",
      "low_stars_per_skill",
      "low_downloads_per_skill",
    ],
  },
  {
    index: 5,
    label: "review",
    status: "pending",
    zScore: 2.3,
    publishedSkills: 640,
    totalInstalls: 410,
    totalStars: 18,
    totalDownloads: 38000,
    reasonCodes: ["high_catalog_volume", "low_installs_per_skill", "low_stars_per_skill"],
  },
  {
    index: 6,
    label: "review",
    status: "pending",
    zScore: 2.1,
    publishedSkills: 520,
    totalInstalls: 380,
    totalStars: 15,
    totalDownloads: 32000,
    reasonCodes: ["high_catalog_volume", "low_installs_per_skill", "low_stars_per_skill"],
  },
  {
    index: 7,
    label: "review",
    status: "pending",
    zScore: 1.9,
    publishedSkills: 410,
    totalInstalls: 520,
    totalStars: 22,
    totalDownloads: 41000,
    reasonCodes: ["high_catalog_volume", "low_installs_per_skill", "low_stars_per_skill"],
  },
  {
    index: 8,
    label: "review",
    status: "pending",
    zScore: 1.7,
    publishedSkills: 300,
    totalInstalls: 480,
    totalStars: 26,
    totalDownloads: 36000,
    reasonCodes: ["high_catalog_volume", "low_installs_per_skill", "low_stars_per_skill"],
  },
  {
    index: 9,
    label: "review",
    status: "pending",
    zScore: 1.6,
    publishedSkills: 260,
    totalInstalls: 460,
    totalStars: 30,
    totalDownloads: 33000,
    reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
  },
  {
    index: 10,
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
    index: 11,
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
    index: 12,
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
];

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

export const seed = mutation({
  args: {},
  handler: async (ctx): Promise<{ runId: Id<"publisherAbuseScoreRuns">; inserted: number }> => {
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
        ownerKey: `${DEMO_OWNER_KEY_PREFIX}${paddedIndex(publisher.index)}`,
        handleSnapshot: `${DEMO_HANDLE_PREFIX}${paddedIndex(publisher.index)}`,
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
      const handle = `${DEMO_HANDLE_PREFIX}${paddedIndex(publisher.index)}`;
      const ownerKey = `${DEMO_OWNER_KEY_PREFIX}${paddedIndex(publisher.index)}`;
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

export const clearSeed = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ runs: number; scores: number; nominations: number; users: number }> => {
    let runs = 0;
    let scores = 0;
    let nominations = 0;
    let users = 0;

    const scoreDocs = await ctx.db.query("publisherAbuseScores").collect();
    const demoRunIds = new Set<Id<"publisherAbuseScoreRuns">>();
    for (const score of scoreDocs) {
      if (!isDemoOwnerKey(score.ownerKey) && !isDemoHandle(score.handleSnapshot)) continue;
      demoRunIds.add(score.runId);
      await ctx.db.delete(score._id);
      scores += 1;
    }

    const nominationDocs = await ctx.db.query("publisherAbuseReviewNominations").collect();
    for (const nomination of nominationDocs) {
      if (!isDemoOwnerKey(nomination.ownerKey) && !isDemoHandle(nomination.handleSnapshot)) {
        continue;
      }
      demoRunIds.add(nomination.openedByRunId);
      await ctx.db.delete(nomination._id);
      nominations += 1;
    }

    for (const runId of demoRunIds) {
      const run = await ctx.db.get(runId);
      if (!run) continue;
      await ctx.db.delete(runId);
      runs += 1;
    }

    const userDocs = await ctx.db.query("users").collect();
    for (const user of userDocs) {
      if (!user.handle || !isDemoHandle(user.handle)) continue;
      await ctx.db.delete(user._id);
      users += 1;
    }

    return { runs, scores, nominations, users };
  },
});
