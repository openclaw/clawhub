import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { EMBEDDING_DIMENSIONS } from "./lib/embeddings";

const PLATFORM_SKILL_LICENSE = "MIT-0" as const;

const manualModerationOverride = v.object({
  verdict: v.literal("clean"),
  note: v.string(),
  reviewerUserId: v.id("users"),
  updatedAt: v.number(),
});

const users = defineTable({
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  handle: v.optional(v.string()),
  displayName: v.optional(v.string()),
  bio: v.optional(v.string()),
  role: v.optional(v.union(v.literal("admin"), v.literal("moderator"), v.literal("user"))),
  githubCreatedAt: v.optional(v.number()),
  githubFetchedAt: v.optional(v.number()),
  githubProfileSyncedAt: v.optional(v.number()),
  trustedPublisher: v.optional(v.boolean()),
  requiresModerationAt: v.optional(v.number()),
  requiresModerationReason: v.optional(v.string()),
  deactivatedAt: v.optional(v.number()),
  purgedAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
  banReason: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
})
  .index("email", ["email"])
  .index("phone", ["phone"])
  .index("handle", ["handle"]);

// Shared validator fragments used by both `skills` and `skillSearchDigest`.
const forkOfValidator = v.optional(
  v.object({
    skillId: v.id("skills"),
    kind: v.union(v.literal("fork"), v.literal("duplicate")),
    version: v.optional(v.string()),
    at: v.number(),
  }),
);

const badgeEntryValidator = v.optional(v.object({ byUserId: v.id("users"), at: v.number() }));

const badgesValidator = v.optional(
  v.object({
    redactionApproved: badgeEntryValidator,
    highlighted: badgeEntryValidator,
    official: badgeEntryValidator,
    deprecated: badgeEntryValidator,
  }),
);

const statsValidator = v.object({
  downloads: v.number(),
  installsCurrent: v.optional(v.number()),
  installsAllTime: v.optional(v.number()),
  stars: v.number(),
  versions: v.number(),
  comments: v.number(),
});

const moderationStatusValidator = v.optional(
  v.union(v.literal("active"), v.literal("hidden"), v.literal("removed")),
);

const skills = defineTable({
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  resourceId: v.optional(v.string()),
  ownerUserId: v.id("users"),
  canonicalSkillId: v.optional(v.id("skills")),
  forkOf: forkOfValidator,
  latestVersionId: v.optional(v.id("skillVersions")),
  latestVersionSummary: v.optional(
    v.object({
      version: v.string(),
      createdAt: v.number(),
      changelog: v.string(),
      changelogSource: v.optional(v.union(v.literal("auto"), v.literal("user"))),
      clawdis: v.optional(v.any()),
    }),
  ),
  tags: v.record(v.string(), v.id("skillVersions")),
  softDeletedAt: v.optional(v.number()),
  badges: badgesValidator,
  moderationStatus: moderationStatusValidator,
  moderationNotes: v.optional(v.string()),
  moderationReason: v.optional(v.string()),
  moderationVerdict: v.optional(
    v.union(v.literal("clean"), v.literal("suspicious"), v.literal("malicious")),
  ),
  moderationReasonCodes: v.optional(v.array(v.string())),
  moderationEvidence: v.optional(
    v.array(
      v.object({
        code: v.string(),
        severity: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
        file: v.string(),
        line: v.number(),
        message: v.string(),
        evidence: v.string(),
      }),
    ),
  ),
  moderationSummary: v.optional(v.string()),
  moderationEngineVersion: v.optional(v.string()),
  moderationEvaluatedAt: v.optional(v.number()),
  moderationSourceVersionId: v.optional(v.id("skillVersions")),
  manualOverride: v.optional(manualModerationOverride),
  quality: v.optional(
    v.object({
      score: v.number(),
      decision: v.union(v.literal("pass"), v.literal("quarantine"), v.literal("reject")),
      trustTier: v.union(v.literal("low"), v.literal("medium"), v.literal("trusted")),
      similarRecentCount: v.number(),
      reason: v.string(),
      signals: v.object({
        bodyChars: v.number(),
        bodyWords: v.number(),
        uniqueWordRatio: v.number(),
        headingCount: v.number(),
        bulletCount: v.number(),
        templateMarkerHits: v.number(),
        genericSummary: v.boolean(),
        cjkChars: v.optional(v.number()),
      }),
      evaluatedAt: v.number(),
    }),
  ),
  isSuspicious: v.optional(v.boolean()),
  moderationFlags: v.optional(v.array(v.string())),
  lastReviewedAt: v.optional(v.number()),
  // VT scan tracking
  scanLastCheckedAt: v.optional(v.number()),
  scanCheckCount: v.optional(v.number()),
  hiddenAt: v.optional(v.number()),
  hiddenBy: v.optional(v.id("users")),
  reportCount: v.optional(v.number()),
  lastReportedAt: v.optional(v.number()),
  batch: v.optional(v.string()),
  statsDownloads: v.optional(v.number()),
  statsStars: v.optional(v.number()),
  statsInstallsCurrent: v.optional(v.number()),
  statsInstallsAllTime: v.optional(v.number()),
  stats: statsValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_slug", ["slug"])
  .index("by_owner", ["ownerUserId"])
  .index("by_updated", ["updatedAt"])
  .index("by_stats_downloads", ["statsDownloads", "updatedAt"])
  .index("by_stats_stars", ["statsStars", "updatedAt"])
  .index("by_stats_installs_current", ["statsInstallsCurrent", "updatedAt"])
  .index("by_stats_installs_all_time", ["statsInstallsAllTime", "updatedAt"])
  .index("by_batch", ["batch"])
  .index("by_active_updated", ["softDeletedAt", "updatedAt"])
  .index("by_active_created", ["softDeletedAt", "createdAt"])
  .index("by_active_name", ["softDeletedAt", "displayName"])
  .index("by_active_stats_downloads", ["softDeletedAt", "statsDownloads", "updatedAt"])
  .index("by_active_stats_stars", ["softDeletedAt", "statsStars", "updatedAt"])
  .index("by_active_stats_installs_all_time", [
    "softDeletedAt",
    "statsInstallsAllTime",
    "updatedAt",
  ])
  .index("by_canonical", ["canonicalSkillId"])
  .index("by_fork_of", ["forkOf.skillId"])
  .index("by_moderation", ["moderationStatus", "moderationReason"])
  .index("by_nonsuspicious_updated", ["softDeletedAt", "isSuspicious", "updatedAt"])
  .index("by_nonsuspicious_created", ["softDeletedAt", "isSuspicious", "createdAt"])
  .index("by_nonsuspicious_name", ["softDeletedAt", "isSuspicious", "displayName"])
  .index("by_nonsuspicious_downloads", [
    "softDeletedAt",
    "isSuspicious",
    "statsDownloads",
    "updatedAt",
  ])
  .index("by_nonsuspicious_stars", ["softDeletedAt", "isSuspicious", "statsStars", "updatedAt"])
  .index("by_nonsuspicious_installs", [
    "softDeletedAt",
    "isSuspicious",
    "statsInstallsAllTime",
    "updatedAt",
  ]);

const skillSlugAliases = defineTable({
  slug: v.string(),
  skillId: v.id("skills"),
  ownerUserId: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_slug", ["slug"])
  .index("by_skill", ["skillId"])
  .index("by_owner", ["ownerUserId"]);

const souls = defineTable({
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  ownerUserId: v.id("users"),
  latestVersionId: v.optional(v.id("soulVersions")),
  tags: v.record(v.string(), v.id("soulVersions")),
  softDeletedAt: v.optional(v.number()),
  stats: v.object({
    downloads: v.number(),
    stars: v.number(),
    versions: v.number(),
    comments: v.number(),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_slug", ["slug"])
  .index("by_owner", ["ownerUserId"])
  .index("by_updated", ["updatedAt"]);

const skillVersions = defineTable({
  skillId: v.id("skills"),
  version: v.string(),
  fingerprint: v.optional(v.string()),
  changelog: v.string(),
  changelogSource: v.optional(v.union(v.literal("auto"), v.literal("user"))),
  files: v.array(
    v.object({
      path: v.string(),
      size: v.number(),
      storageId: v.id("_storage"),
      sha256: v.string(),
      contentType: v.optional(v.string()),
    }),
  ),
  parsed: v.object({
    frontmatter: v.record(v.string(), v.any()),
    metadata: v.optional(v.any()),
    clawdis: v.optional(v.any()),
    moltbot: v.optional(v.any()),
    license: v.optional(v.literal(PLATFORM_SKILL_LICENSE)),
  }),
  createdBy: v.id("users"),
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
  sha256hash: v.optional(v.string()),
  vtAnalysis: v.optional(
    v.object({
      status: v.string(),
      verdict: v.optional(v.string()),
      analysis: v.optional(v.string()),
      source: v.optional(v.string()),
      checkedAt: v.number(),
    }),
  ),
  llmAnalysis: v.optional(
    v.object({
      status: v.string(),
      verdict: v.optional(v.string()),
      confidence: v.optional(v.string()),
      summary: v.optional(v.string()),
      dimensions: v.optional(
        v.array(
          v.object({
            name: v.string(),
            label: v.string(),
            rating: v.string(),
            detail: v.string(),
          }),
        ),
      ),
      guidance: v.optional(v.string()),
      findings: v.optional(v.string()),
      model: v.optional(v.string()),
      checkedAt: v.number(),
    }),
  ),
  staticScan: v.optional(
    v.object({
      status: v.union(v.literal("clean"), v.literal("suspicious"), v.literal("malicious")),
      reasonCodes: v.array(v.string()),
      findings: v.array(
        v.object({
          code: v.string(),
          severity: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
          file: v.string(),
          line: v.number(),
          message: v.string(),
          evidence: v.string(),
        }),
      ),
      summary: v.string(),
      engineVersion: v.string(),
      checkedAt: v.number(),
    }),
  ),
})
  .index("by_skill", ["skillId"])
  .index("by_skill_version", ["skillId", "version"])
  .index("by_sha256hash", ["sha256hash"]);

const soulVersions = defineTable({
  soulId: v.id("souls"),
  version: v.string(),
  fingerprint: v.optional(v.string()),
  changelog: v.string(),
  changelogSource: v.optional(v.union(v.literal("auto"), v.literal("user"))),
  files: v.array(
    v.object({
      path: v.string(),
      size: v.number(),
      storageId: v.id("_storage"),
      sha256: v.string(),
      contentType: v.optional(v.string()),
    }),
  ),
  parsed: v.object({
    frontmatter: v.record(v.string(), v.any()),
    metadata: v.optional(v.any()),
    clawdis: v.optional(v.any()),
    moltbot: v.optional(v.any()),
  }),
  createdBy: v.id("users"),
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
})
  .index("by_soul", ["soulId"])
  .index("by_soul_version", ["soulId", "version"]);

const skillVersionFingerprints = defineTable({
  skillId: v.id("skills"),
  versionId: v.id("skillVersions"),
  fingerprint: v.string(),
  createdAt: v.number(),
})
  .index("by_version", ["versionId"])
  .index("by_fingerprint", ["fingerprint"])
  .index("by_skill_fingerprint", ["skillId", "fingerprint"]);

const skillBadges = defineTable({
  skillId: v.id("skills"),
  kind: v.union(
    v.literal("highlighted"),
    v.literal("official"),
    v.literal("deprecated"),
    v.literal("redactionApproved"),
  ),
  byUserId: v.id("users"),
  at: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_skill_kind", ["skillId", "kind"])
  .index("by_kind_at", ["kind", "at"]);

const soulVersionFingerprints = defineTable({
  soulId: v.id("souls"),
  versionId: v.id("soulVersions"),
  fingerprint: v.string(),
  createdAt: v.number(),
})
  .index("by_version", ["versionId"])
  .index("by_fingerprint", ["fingerprint"])
  .index("by_soul_fingerprint", ["soulId", "fingerprint"]);

const skillEmbeddings = defineTable({
  skillId: v.id("skills"),
  versionId: v.id("skillVersions"),
  ownerId: v.id("users"),
  embedding: v.array(v.number()),
  isLatest: v.boolean(),
  isApproved: v.boolean(),
  visibility: v.string(),
  updatedAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_version", ["versionId"])
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: EMBEDDING_DIMENSIONS,
    filterFields: ["visibility"],
  });

// Lightweight lookup: embeddingId → skillId (~100 bytes per doc).
// Avoids reading full skillEmbeddings docs (~12KB each with vector)
// during search hydration.
const embeddingSkillMap = defineTable({
  embeddingId: v.id("skillEmbeddings"),
  skillId: v.id("skills"),
}).index("by_embedding", ["embeddingId"]);

// Lightweight projection of skill docs for search hydration (~800 bytes vs ~3-5KB).
// Contains exactly the fields needed by toPublicSkill() + isPublicSkillDoc() + isSkillSuspicious().
const skillSearchDigest = defineTable({
  skillId: v.id("skills"),
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  ownerUserId: v.id("users"),
  ownerHandle: v.optional(v.string()),
  ownerName: v.optional(v.string()),
  ownerDisplayName: v.optional(v.string()),
  ownerImage: v.optional(v.string()),
  canonicalSkillId: v.optional(v.id("skills")),
  forkOf: forkOfValidator,
  latestVersionId: v.optional(v.id("skillVersions")),
  latestVersionSummary: v.optional(
    v.object({
      version: v.string(),
      createdAt: v.number(),
      changelog: v.string(),
      changelogSource: v.optional(v.union(v.literal("auto"), v.literal("user"))),
      clawdis: v.optional(v.any()),
    }),
  ),
  tags: v.record(v.string(), v.id("skillVersions")),
  badges: badgesValidator,
  stats: statsValidator,
  statsDownloads: v.optional(v.number()),
  statsStars: v.optional(v.number()),
  statsInstallsCurrent: v.optional(v.number()),
  statsInstallsAllTime: v.optional(v.number()),
  softDeletedAt: v.optional(v.number()),
  moderationStatus: moderationStatusValidator,
  moderationFlags: v.optional(v.array(v.string())),
  moderationReason: v.optional(v.string()),
  isSuspicious: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_active_updated", ["softDeletedAt", "updatedAt"])
  .index("by_active_created", ["softDeletedAt", "createdAt"])
  .index("by_active_name", ["softDeletedAt", "displayName"])
  .index("by_active_stats_downloads", ["softDeletedAt", "statsDownloads", "updatedAt"])
  .index("by_active_stats_stars", ["softDeletedAt", "statsStars", "updatedAt"])
  .index("by_active_stats_installs_all_time", [
    "softDeletedAt",
    "statsInstallsAllTime",
    "updatedAt",
  ])
  .index("by_nonsuspicious_updated", ["softDeletedAt", "isSuspicious", "updatedAt"])
  .index("by_nonsuspicious_created", ["softDeletedAt", "isSuspicious", "createdAt"])
  .index("by_nonsuspicious_name", ["softDeletedAt", "isSuspicious", "displayName"])
  .index("by_nonsuspicious_downloads", [
    "softDeletedAt",
    "isSuspicious",
    "statsDownloads",
    "updatedAt",
  ])
  .index("by_nonsuspicious_stars", ["softDeletedAt", "isSuspicious", "statsStars", "updatedAt"])
  .index("by_nonsuspicious_installs", [
    "softDeletedAt",
    "isSuspicious",
    "statsInstallsAllTime",
    "updatedAt",
  ]);

const skillDailyStats = defineTable({
  skillId: v.id("skills"),
  day: v.number(),
  downloads: v.number(),
  installs: v.number(),
  updatedAt: v.number(),
})
  .index("by_skill_day", ["skillId", "day"])
  .index("by_day", ["day"]);

const skillLeaderboards = defineTable({
  kind: v.string(),
  generatedAt: v.number(),
  rangeStartDay: v.number(),
  rangeEndDay: v.number(),
  items: v.array(
    v.object({
      skillId: v.id("skills"),
      score: v.number(),
      installs: v.number(),
      downloads: v.number(),
    }),
  ),
}).index("by_kind", ["kind", "generatedAt"]);

const skillStatBackfillState = defineTable({
  key: v.string(),
  cursor: v.optional(v.string()),
  doneAt: v.optional(v.number()),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

const globalStats = defineTable({
  key: v.string(),
  activeSkillsCount: v.number(),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

const skillStatEvents = defineTable({
  skillId: v.id("skills"),
  kind: v.union(
    v.literal("download"),
    v.literal("star"),
    v.literal("unstar"),
    v.literal("comment"),
    v.literal("uncomment"),
    v.literal("install_new"),
    v.literal("install_reactivate"),
    v.literal("install_deactivate"),
    v.literal("install_clear"),
  ),
  delta: v.optional(
    v.object({
      allTime: v.number(),
      current: v.number(),
    }),
  ),
  occurredAt: v.number(),
  processedAt: v.optional(v.number()),
})
  .index("by_unprocessed", ["processedAt"])
  .index("by_skill", ["skillId"]);

const skillStatUpdateCursors = defineTable({
  key: v.string(),
  cursorCreationTime: v.optional(v.number()),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

const soulEmbeddings = defineTable({
  soulId: v.id("souls"),
  versionId: v.id("soulVersions"),
  ownerId: v.id("users"),
  embedding: v.array(v.number()),
  isLatest: v.boolean(),
  isApproved: v.boolean(),
  visibility: v.string(),
  updatedAt: v.number(),
})
  .index("by_soul", ["soulId"])
  .index("by_version", ["versionId"])
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: EMBEDDING_DIMENSIONS,
    filterFields: ["visibility"],
  });

const comments = defineTable({
  skillId: v.id("skills"),
  userId: v.id("users"),
  body: v.string(),
  reportCount: v.optional(v.number()),
  lastReportedAt: v.optional(v.number()),
  scamScanVerdict: v.optional(
    v.union(v.literal("not_scam"), v.literal("likely_scam"), v.literal("certain_scam")),
  ),
  scamScanConfidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  scamScanExplanation: v.optional(v.string()),
  scamScanEvidence: v.optional(v.array(v.string())),
  scamScanModel: v.optional(v.string()),
  scamScanCheckedAt: v.optional(v.number()),
  scamBanTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
})
  .index("by_skill", ["skillId"])
  .index("by_user", ["userId"])
  .index("by_scam_scan_checked", ["scamScanCheckedAt"]);

const commentReports = defineTable({
  commentId: v.id("comments"),
  skillId: v.id("skills"),
  userId: v.id("users"),
  reason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_comment", ["commentId"])
  .index("by_comment_createdAt", ["commentId", "createdAt"])
  .index("by_skill", ["skillId"])
  .index("by_user", ["userId"])
  .index("by_comment_user", ["commentId", "userId"]);

const skillReports = defineTable({
  skillId: v.id("skills"),
  userId: v.id("users"),
  reason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_skill_createdAt", ["skillId", "createdAt"])
  .index("by_user", ["userId"])
  .index("by_skill_user", ["skillId", "userId"]);

const soulComments = defineTable({
  soulId: v.id("souls"),
  userId: v.id("users"),
  body: v.string(),
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
})
  .index("by_soul", ["soulId"])
  .index("by_user", ["userId"]);

const stars = defineTable({
  skillId: v.id("skills"),
  userId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_user", ["userId"])
  .index("by_skill_user", ["skillId", "userId"]);

const soulStars = defineTable({
  soulId: v.id("souls"),
  userId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_soul", ["soulId"])
  .index("by_user", ["userId"])
  .index("by_soul_user", ["soulId", "userId"]);

const auditLogs = defineTable({
  actorUserId: v.id("users"),
  action: v.string(),
  targetType: v.string(),
  targetId: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_actor", ["actorUserId"])
  .index("by_target", ["targetType", "targetId"])
  .index("by_target_createdAt", ["targetType", "targetId", "createdAt"]);

const vtScanLogs = defineTable({
  type: v.union(v.literal("daily_rescan"), v.literal("backfill"), v.literal("pending_poll")),
  total: v.number(),
  updated: v.number(),
  unchanged: v.number(),
  errors: v.number(),
  flaggedSkills: v.optional(
    v.array(
      v.object({
        slug: v.string(),
        status: v.string(),
      }),
    ),
  ),
  durationMs: v.number(),
  createdAt: v.number(),
}).index("by_type_date", ["type", "createdAt"]);

const apiTokens = defineTable({
  userId: v.id("users"),
  label: v.string(),
  prefix: v.string(),
  tokenHash: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_hash", ["tokenHash"]);

const rateLimits = defineTable({
  key: v.string(),
  windowStart: v.number(),
  count: v.number(),
  limit: v.number(),
  updatedAt: v.number(),
})
  .index("by_key_window", ["key", "windowStart"])
  .index("by_key", ["key"]);

const downloadDedupes = defineTable({
  skillId: v.id("skills"),
  identityHash: v.string(),
  hourStart: v.number(),
  createdAt: v.number(),
})
  .index("by_skill_identity_hour", ["skillId", "identityHash", "hourStart"])
  .index("by_hour", ["hourStart"]);

const reservedSlugs = defineTable({
  slug: v.string(),
  originalOwnerUserId: v.id("users"),
  deletedAt: v.number(),
  expiresAt: v.number(),
  reason: v.optional(v.string()),
  releasedAt: v.optional(v.number()),
})
  .index("by_slug", ["slug"])
  .index("by_slug_active_deletedAt", ["slug", "releasedAt", "deletedAt"])
  .index("by_owner", ["originalOwnerUserId"])
  .index("by_expiry", ["expiresAt"]);

const githubBackupSyncState = defineTable({
  key: v.string(),
  cursor: v.optional(v.string()),
  pruneCursor: v.optional(v.string()),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

const userSyncRoots = defineTable({
  userId: v.id("users"),
  rootId: v.string(),
  label: v.string(),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  expiredAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_root", ["userId", "rootId"]);

const userSkillInstalls = defineTable({
  userId: v.id("users"),
  skillId: v.id("skills"),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  activeRoots: v.number(),
  lastVersion: v.optional(v.string()),
})
  .index("by_user", ["userId"])
  .index("by_user_skill", ["userId", "skillId"])
  .index("by_skill", ["skillId"]);

const userSkillRootInstalls = defineTable({
  userId: v.id("users"),
  rootId: v.string(),
  skillId: v.id("skills"),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  lastVersion: v.optional(v.string()),
  removedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_root", ["userId", "rootId"])
  .index("by_user_root_skill", ["userId", "rootId", "skillId"])
  .index("by_user_skill", ["userId", "skillId"])
  .index("by_skill", ["skillId"]);

const skillOwnershipTransfers = defineTable({
  skillId: v.id("skills"),
  fromUserId: v.id("users"),
  toUserId: v.id("users"),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("cancelled"),
    v.literal("expired"),
  ),
  message: v.optional(v.string()),
  requestedAt: v.number(),
  respondedAt: v.optional(v.number()),
  expiresAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_from_user", ["fromUserId"])
  .index("by_to_user", ["toUserId"])
  .index("by_to_user_status", ["toUserId", "status"])
  .index("by_from_user_status", ["fromUserId", "status"])
  .index("by_skill_status", ["skillId", "status"]);

export default defineSchema({
  ...authTables,
  users,
  skills,
  skillSlugAliases,
  souls,
  skillVersions,
  soulVersions,
  skillVersionFingerprints,
  skillBadges,
  soulVersionFingerprints,
  skillEmbeddings,
  embeddingSkillMap,
  skillSearchDigest,
  soulEmbeddings,
  skillDailyStats,
  skillLeaderboards,
  skillStatBackfillState,
  globalStats,
  skillStatEvents,
  skillStatUpdateCursors,
  comments,
  commentReports,
  skillReports,
  soulComments,
  stars,
  soulStars,
  auditLogs,
  vtScanLogs,
  apiTokens,
  rateLimits,
  downloadDedupes,
  reservedSlugs,
  githubBackupSyncState,
  userSyncRoots,
  userSkillInstalls,
  userSkillRootInstalls,
  skillOwnershipTransfers,
});
