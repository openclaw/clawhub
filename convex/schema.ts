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

const vtEngineStatsValidator = v.object({
  malicious: v.optional(v.number()),
  suspicious: v.optional(v.number()),
  undetected: v.optional(v.number()),
  harmless: v.optional(v.number()),
});

const vtAnalysisValidator = v.object({
  status: v.string(),
  verdict: v.optional(v.string()),
  analysis: v.optional(v.string()),
  source: v.optional(v.string()),
  scanner: v.optional(v.string()),
  engineStats: v.optional(vtEngineStatsValidator),
  checkedAt: v.number(),
});

const skillSpectorIssueValidator = v.object({
  issueId: v.string(),
  category: v.optional(v.string()),
  pattern: v.optional(v.string()),
  severity: v.string(),
  confidence: v.optional(v.number()),
  file: v.optional(v.string()),
  startLine: v.optional(v.number()),
  endLine: v.optional(v.number()),
  explanation: v.string(),
  remediation: v.optional(v.string()),
  finding: v.optional(v.string()),
  codeSnippet: v.optional(v.string()),
});

const skillSpectorAnalysisValidator = v.object({
  status: v.string(),
  score: v.optional(v.number()),
  severity: v.optional(v.string()),
  recommendation: v.optional(v.string()),
  issueCount: v.number(),
  // Scanner/action boundaries cap this array before storage; Convex validators cannot express max length.
  issues: v.array(skillSpectorIssueValidator),
  scannerVersion: v.optional(v.string()),
  summary: v.optional(v.string()),
  error: v.optional(v.string()),
  checkedAt: v.number(),
});

const depRegistryStatusValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("error"),
);

const depRegistryValidator = v.union(v.literal("pypi"), v.literal("npm"), v.literal("cargo"));

const depRegistryAnalysisValidator = v.object({
  status: depRegistryStatusValidator,
  results: v.array(
    v.object({
      name: v.string(),
      registry: depRegistryValidator,
      source: v.string(),
      exists: v.boolean(),
      httpStatus: v.optional(v.number()),
    }),
  ),
  notFoundPackages: v.array(v.string()),
  unresolvedPackages: v.array(v.string()),
  summary: v.string(),
  checkedAt: v.number(),
});

const llmAgenticRiskEvidenceValidator = v.object({
  path: v.string(),
  snippet: v.string(),
  explanation: v.string(),
});

const llmAgenticRiskFindingValidator = v.object({
  categoryId: v.string(),
  categoryLabel: v.string(),
  riskBucket: v.union(
    v.literal("abnormal_behavior_control"),
    v.literal("permission_boundary"),
    v.literal("sensitive_data_protection"),
  ),
  status: v.union(v.literal("none"), v.literal("note"), v.literal("concern")),
  severity: v.string(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  evidence: v.optional(llmAgenticRiskEvidenceValidator),
  userImpact: v.string(),
  recommendation: v.string(),
});

const llmRiskSummaryBucketValidator = v.object({
  status: v.union(v.literal("none"), v.literal("note"), v.literal("concern")),
  summary: v.string(),
  highestSeverity: v.optional(v.string()),
});

const llmAnalysisValidator = v.object({
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
  agenticRiskFindings: v.optional(v.array(llmAgenticRiskFindingValidator)),
  riskSummary: v.optional(
    v.object({
      abnormal_behavior_control: llmRiskSummaryBucketValidator,
      permission_boundary: llmRiskSummaryBucketValidator,
      sensitive_data_protection: llmRiskSummaryBucketValidator,
    }),
  ),
  model: v.optional(v.string()),
  checkedAt: v.number(),
});

const staticScanValidator = v.object({
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
  publishedSkills: v.optional(v.number()),
  totalStars: v.optional(v.number()),
  totalDownloads: v.optional(v.number()),
  personalPublisherId: v.optional(v.id("publishers")),
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
  .index("handle", ["handle"])
  .index("by_ban_reason_deleted_at", ["banReason", "deletedAt"])
  .index("by_deactivated_purged_at", ["deactivatedAt", "purgedAt"])
  .index("by_active_handle", ["deletedAt", "deactivatedAt", "handle"]);

const authSessions = defineTable({
  userId: v.id("users"),
  expirationTime: v.number(),
})
  .index("userId", ["userId"])
  .index("by_expiration_time", ["expirationTime"]);

const authRefreshTokens = defineTable({
  sessionId: v.id("authSessions"),
  expirationTime: v.number(),
  firstUsedTime: v.optional(v.number()),
  parentRefreshTokenId: v.optional(v.id("authRefreshTokens")),
})
  .index("sessionId", ["sessionId"])
  .index("sessionIdAndParentRefreshTokenId", ["sessionId", "parentRefreshTokenId"])
  .index("by_expiration_time", ["expirationTime"]);

const publishers = defineTable({
  kind: v.union(v.literal("user"), v.literal("org")),
  handle: v.string(),
  displayName: v.string(),
  bio: v.optional(v.string()),
  image: v.optional(v.string()),
  imageStorageId: v.optional(v.id("_storage")),
  linkedUserId: v.optional(v.id("users")),
  trustedPublisher: v.optional(v.boolean()),
  publishedSkills: v.optional(v.number()),
  publishedPackages: v.optional(v.number()),
  totalInstalls: v.optional(v.number()),
  totalDownloads: v.optional(v.number()),
  totalStars: v.optional(v.number()),
  skillTotalInstalls: v.optional(v.number()),
  skillTotalDownloads: v.optional(v.number()),
  skillTotalStars: v.optional(v.number()),
  deactivatedAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_handle", ["handle"])
  .index("by_linked_user", ["linkedUserId"])
  .index("by_kind_handle", ["kind", "handle"])
  .index("by_active_kind_handle", ["deletedAt", "deactivatedAt", "kind", "handle"])
  .index("by_active_total_downloads", ["deletedAt", "deactivatedAt", "totalDownloads", "updatedAt"])
  .index("by_active_kind_total_downloads", [
    "deletedAt",
    "deactivatedAt",
    "kind",
    "totalDownloads",
    "updatedAt",
  ])
  .index("by_active_total_installs", ["deletedAt", "deactivatedAt", "totalInstalls", "updatedAt"])
  .index("by_active_kind_total_installs", [
    "deletedAt",
    "deactivatedAt",
    "kind",
    "totalInstalls",
    "updatedAt",
  ]);

const publisherMembers = defineTable({
  publisherId: v.id("publishers"),
  userId: v.id("users"),
  role: v.union(v.literal("owner"), v.literal("admin"), v.literal("publisher")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_publisher", ["publisherId"])
  .index("by_publisher_and_role", ["publisherId", "role"])
  .index("by_user", ["userId"])
  .index("by_publisher_user", ["publisherId", "userId"]);

const publisherInvites = defineTable({
  publisherId: v.id("publishers"),
  inviterUserId: v.id("users"),
  targetHandle: v.string(),
  targetUserId: v.optional(v.id("users")),
  role: v.union(v.literal("owner"), v.literal("admin"), v.literal("publisher")),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("declined"),
    v.literal("revoked"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
  acceptedByUserId: v.optional(v.id("users")),
  declinedAt: v.optional(v.number()),
  declinedByUserId: v.optional(v.id("users")),
  revokedAt: v.optional(v.number()),
  revokedByUserId: v.optional(v.id("users")),
})
  .index("by_publisher_status_expires", ["publisherId", "status", "expiresAt"])
  .index("by_publisher_target_status_expires", [
    "publisherId",
    "targetHandle",
    "status",
    "expiresAt",
  ])
  .index("by_publisher_target_user_status_expires", [
    "publisherId",
    "targetUserId",
    "status",
    "expiresAt",
  ])
  .index("by_target_handle_status_expires", ["targetHandle", "status", "expiresAt"])
  .index("by_target_user_status_expires", ["targetUserId", "status", "expiresAt"])
  .index("by_expires_at", ["expiresAt"]);

const publisherImageUploadTickets = defineTable({
  publisherId: v.id("publishers"),
  userId: v.id("users"),
  createdAt: v.number(),
  expiresAt: v.number(),
  usedAt: v.optional(v.number()),
  storageId: v.optional(v.id("_storage")),
}).index("by_publisher_user", ["publisherId", "userId"]);

const officialPublishers = defineTable({
  publisherId: v.id("publishers"),
  reason: v.optional(v.string()),
  createdByUserId: v.optional(v.id("users")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_publisher", ["publisherId"])
  .index("by_created", ["createdAt"]);

const displayManifestStatusValidator = v.union(
  v.literal("ok"),
  v.literal("missing"),
  v.literal("invalid"),
  v.literal("failed"),
);

const displayManifestValidator = v.object({
  notGrouped: v.optional(v.union(v.literal("top"), v.literal("bottom"))),
  groupings: v.array(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      skills: v.array(v.string()),
    }),
  ),
});

const githubSkillSourceInvalidSkillValidator = v.object({
  slug: v.string(),
  path: v.string(),
  displayName: v.string(),
  error: v.string(),
});

const githubSkillSourceIssueValidator = v.object({
  slug: v.string(),
  path: v.string(),
  displayName: v.string(),
  kind: v.union(v.literal("invalid_slug"), v.literal("slug_conflict")),
  severity: v.union(v.literal("error"), v.literal("warning")),
  message: v.string(),
  existingOwnerHandle: v.optional(v.string()),
});

const githubSkillSources = defineTable({
  repo: v.string(),
  ownerPublisherId: v.optional(v.id("publishers")),
  defaultBranch: v.optional(v.string()),
  lastSyncStatus: v.optional(v.union(v.literal("ok"), v.literal("failed"), v.literal("skipped"))),
  lastSyncError: v.optional(v.string()),
  lastSyncErrorAt: v.optional(v.number()),
  displayManifestKind: v.optional(v.literal("skills.sh")),
  displayManifestHash: v.optional(v.string()),
  displayManifestCommit: v.optional(v.string()),
  displayManifestFetchedAt: v.optional(v.number()),
  displayManifestStatus: v.optional(displayManifestStatusValidator),
  displayManifest: v.optional(displayManifestValidator),
  lastSyncIssues: v.optional(v.array(githubSkillSourceIssueValidator)),
  // Deprecated. Use lastSyncIssues; kept optional for deployed rows and rollback safety.
  lastSyncInvalidSkills: v.optional(v.array(githubSkillSourceInvalidSkillValidator)),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_repo", ["repo"])
  .index("by_owner_publisher", ["ownerPublisherId"])
  .index("by_owner_publisher_and_repo", ["ownerPublisherId", "repo"])
  .index("by_created", ["createdAt"])
  .index("by_updated", ["updatedAt"]);

const githubSkillContents = defineTable({
  skillId: v.id("skills"),
  githubSourceId: v.id("githubSkillSources"),
  githubPath: v.string(),
  skillMarkdownPath: v.string(),
  skillMarkdown: v.string(),
  skillCardMarkdownPath: v.optional(v.string()),
  skillCardMarkdown: v.optional(v.string()),
  githubCommit: v.string(),
  githubContentHash: v.string(),
  fetchedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_skill_and_content_hash", ["skillId", "githubContentHash"])
  .index("by_github_source", ["githubSourceId"]);

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

/**
 * Nested stat fields on the `skills` document.
 *
 * The four migrated fields below are kept for backward compatibility only.
 * Always use the top-level fields (`statsDownloads`, `statsStars`,
 * `statsInstallsCurrent`, `statsInstallsAllTime`) as the source of truth,
 * and use `readCanonicalStat()` / `applySkillStatDeltas()` to read/write them.
 */
const statsValidator = v.object({
  /** @deprecated Use top-level `statsDownloads` instead. */
  downloads: v.number(),
  /** @deprecated Use top-level `statsInstallsCurrent` instead. */
  installsCurrent: v.optional(v.number()),
  /** @deprecated Use top-level `statsInstallsAllTime` instead. */
  installsAllTime: v.optional(v.number()),
  /** @deprecated Use top-level `statsStars` instead. */
  stars: v.number(),
  versions: v.number(),
  comments: v.number(),
});

const moderationStatusValidator = v.optional(
  v.union(v.literal("active"), v.literal("hidden"), v.literal("removed")),
);

const publicBrowseVersionStateValidator = v.union(
  v.object({
    status: v.literal("available"),
    versionId: v.id("skillVersions"),
  }),
  v.object({
    status: v.literal("unavailable"),
  }),
);

const githubSkillScanStatusValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("pending"),
  v.literal("failed"),
);

const githubSkillCurrentStatusValidator = v.union(
  v.literal("present"),
  v.literal("missing"),
  v.literal("unknown"),
);

const githubSkillScans = defineTable({
  skillId: v.id("skills"),
  githubSourceId: v.id("githubSkillSources"),
  contentHash: v.string(),
  commit: v.string(),
  path: v.string(),
  status: githubSkillScanStatusValidator,
  skillScanRequestId: v.optional(v.id("skillScanRequests")),
  staticScan: v.optional(staticScanValidator),
  skillSpectorAnalysis: v.optional(skillSpectorAnalysisValidator),
  llmAnalysis: v.optional(llmAnalysisValidator),
  lastError: v.optional(v.string()),
  runId: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_skill_and_content_hash", ["skillId", "contentHash"])
  .index("by_github_source_and_updated_at", ["githubSourceId", "updatedAt"]);

const packageFamilyValidator = v.union(
  v.literal("skill"),
  v.literal("code-plugin"),
  v.literal("bundle-plugin"),
);

const packageChannelValidator = v.union(
  v.literal("official"),
  v.literal("community"),
  v.literal("private"),
);

const packageVerificationTierValidator = v.union(
  v.literal("structural"),
  v.literal("source-linked"),
  v.literal("provenance-verified"),
  v.literal("rebuild-verified"),
);

const packageVerificationScopeValidator = v.union(
  v.literal("artifact-only"),
  v.literal("dependency-graph-aware"),
);

const publisherAbuseDryRunLabelValidator = v.union(
  v.literal("pass"),
  v.literal("review"),
  v.literal("potential_ban_candidate"),
);

const publisherAbuseTriageStatusValidator = v.union(
  v.literal("pending"),
  v.literal("banned"),
  v.literal("reviewed_no_action"),
  v.literal("false_positive"),
  v.literal("needs_policy_discussion"),
  v.literal("candidate_for_future_action"),
);

const publisherAbuseModelConfigValidator = v.object({
  modelVersion: v.string(),
  skillPivot: v.number(),
  installsPerSkillPivot: v.number(),
  starsPerSkillPivot: v.number(),
  downloadsPerSkillPivot: v.number(),
  outputElasticity: v.number(),
  engagementElasticity: v.optional(v.number()),
  minPublishedSkillsForAggregateLabel: v.optional(v.number()),
  installTrustElasticity: v.number(),
  starTrustElasticity: v.number(),
  downloadDemandElasticity: v.number(),
  minInstallsPerSkill: v.number(),
  minStarsPerSkill: v.number(),
  minDownloadsPerSkill: v.number(),
  reviewZThreshold: v.number(),
  potentialBanCandidateZThreshold: v.number(),
});

const packageStatsValidator = v.object({
  downloads: v.number(),
  installs: v.number(),
  stars: v.number(),
  versions: v.number(),
});

const packageArtifactSummaryValidator = v.optional(
  v.object({
    kind: v.union(v.literal("legacy-zip"), v.literal("npm-pack")),
    sha256: v.optional(v.string()),
    size: v.optional(v.number()),
    format: v.optional(v.string()),
    npmIntegrity: v.optional(v.string()),
    npmShasum: v.optional(v.string()),
    npmTarballName: v.optional(v.string()),
    npmUnpackedSize: v.optional(v.number()),
    npmFileCount: v.optional(v.number()),
  }),
);

const packageCompatibilityValidator = v.optional(
  v.object({
    pluginApiRange: v.optional(v.string()),
    builtWithOpenClawVersion: v.optional(v.string()),
    pluginSdkVersion: v.optional(v.string()),
    minGatewayVersion: v.optional(v.string()),
  }),
);

const pluginManifestSummaryValidator = v.object({
  schemaVersion: v.literal(1),
  compatibility: v.optional(
    v.object({
      pluginApiRange: v.optional(v.string()),
      builtWithOpenClawVersion: v.optional(v.string()),
      pluginSdkVersion: v.optional(v.string()),
      minGatewayVersion: v.optional(v.string()),
    }),
  ),
  manifestIdentity: v.optional(
    v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      version: v.optional(v.string()),
      family: v.optional(v.string()),
    }),
  ),
  configFields: v.array(
    v.object({
      name: v.string(),
      description: v.optional(v.string()),
      required: v.boolean(),
      sensitive: v.boolean(),
    }),
  ),
  mcpServers: v.array(
    v.object({
      name: v.string(),
    }),
  ),
  bundledSkills: v.array(
    v.object({
      name: v.string(),
      description: v.optional(v.string()),
      rootPath: v.string(),
      skillMdPath: v.string(),
      sha256: v.string(),
      size: v.number(),
    }),
  ),
});

const packageVerificationValidator = v.optional(
  v.object({
    tier: packageVerificationTierValidator,
    scope: packageVerificationScopeValidator,
    summary: v.optional(v.string()),
    sourceRepo: v.optional(v.string()),
    sourceCommit: v.optional(v.string()),
    sourceTag: v.optional(v.string()),
    sourcePath: v.optional(v.string()),
    hasProvenance: v.optional(v.boolean()),
    trustedOpenClawPlugin: v.optional(v.boolean()),
    scanStatus: v.optional(
      v.union(
        v.literal("clean"),
        v.literal("suspicious"),
        v.literal("malicious"),
        v.literal("pending"),
        v.literal("not-run"),
      ),
    ),
  }),
);

const packagePublishActorValidator = v.optional(
  v.union(
    v.object({
      kind: v.literal("user"),
      userId: v.id("users"),
    }),
    v.object({
      kind: v.literal("github-actions"),
      repository: v.string(),
      workflow: v.string(),
      runId: v.string(),
      runAttempt: v.string(),
      sha: v.string(),
    }),
  ),
);

const packageScanStatusValidator = v.optional(
  v.union(
    v.literal("clean"),
    v.literal("suspicious"),
    v.literal("malicious"),
    v.literal("pending"),
    v.literal("not-run"),
  ),
);

const packageReleaseModerationOverrideValidator = v.object({
  state: v.union(v.literal("approved"), v.literal("quarantined"), v.literal("revoked")),
  reason: v.string(),
  reviewerUserId: v.id("users"),
  updatedAt: v.number(),
});

const securityScanTargetKindValidator = v.union(
  v.literal("skillVersion"),
  v.literal("packageRelease"),
  v.literal("skillScanRequest"),
);
const securityScanJobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);
const securityScanJobSourceValidator = v.union(
  v.literal("publish"),
  v.literal("vt-update"),
  v.literal("backfill"),
  v.literal("bulk-rescan"),
  v.literal("manual"),
);
const skillCardGenerationJobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);
const skillCardGenerationJobSourceValidator = v.union(
  v.literal("publish"),
  v.literal("scan"),
  v.literal("manual"),
);

const packageFilesValidator = v.array(
  v.object({
    path: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    sha256: v.string(),
    contentType: v.optional(v.string()),
  }),
);

const catalogClassificationConfidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

const catalogClassificationApplyStatusValidator = v.union(
  v.literal("preview"),
  v.literal("applied"),
  v.literal("stale"),
  v.literal("skipped-author"),
  v.literal("error"),
);

const catalogCategoryCandidateValidator = v.object({
  category: v.string(),
  score: v.number(),
  sources: v.array(v.string()),
  evidence: v.array(v.string()),
  strongEvidence: v.optional(v.boolean()),
  primaryEvidence: v.optional(v.boolean()),
  strongPrimaryEvidence: v.optional(v.boolean()),
  primaryEvidenceCount: v.optional(v.number()),
});

const catalogTopicCandidateValidator = v.object({
  topic: v.string(),
  slug: v.string(),
  score: v.number(),
  sources: v.array(v.string()),
  evidence: v.array(v.string()),
  primaryEvidence: v.boolean(),
  primarySourceCount: v.number(),
  strongEvidence: v.boolean(),
  confidence: catalogClassificationConfidenceValidator,
  suppressedBy: v.optional(v.string()),
});

const skillScanRequestSourceKindValidator = v.union(
  v.literal("upload"),
  v.literal("published"),
  v.literal("github"),
);

const skills = defineTable({
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  icon: v.optional(v.string()),
  resourceId: v.optional(v.string()),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  canonicalSkillId: v.optional(v.id("skills")),
  forkOf: forkOfValidator,
  installKind: v.optional(v.literal("github")),
  githubSourceId: v.optional(v.id("githubSkillSources")),
  githubPath: v.optional(v.string()),
  githubHasSkillCard: v.optional(v.boolean()),
  githubCurrentCommit: v.optional(v.string()),
  githubCurrentContentHash: v.optional(v.string()),
  githubCurrentStatus: v.optional(githubSkillCurrentStatusValidator),
  githubCurrentCheckedAt: v.optional(v.number()),
  githubScanStatus: v.optional(githubSkillScanStatusValidator),
  githubRemovedAt: v.optional(v.number()),
  latestVersionId: v.optional(v.id("skillVersions")),
  latestVersionSummary: v.optional(
    v.object({
      version: v.string(),
      createdAt: v.number(),
      changelog: v.string(),
      changelogSource: v.optional(v.union(v.literal("auto"), v.literal("user"))),
      description: v.optional(v.string()),
      clawdis: v.optional(v.any()),
    }),
  ),
  tags: v.record(v.string(), v.id("skillVersions")),
  categories: v.optional(v.array(v.string())),
  topics: v.optional(v.array(v.string())),
  inferredCategories: v.optional(v.array(v.string())),
  inferredTopics: v.optional(v.array(v.string())),
  inferredFromVersionId: v.optional(v.id("skillVersions")),
  inferredCategoryConfidence: v.optional(catalogClassificationConfidenceValidator),
  inferredTopicConfidence: v.optional(catalogClassificationConfidenceValidator),
  inferredClassifierVersion: v.optional(v.string()),
  inferredTopicClassifierVersion: v.optional(v.string()),
  inferredInputHash: v.optional(v.string()),
  inferredTopicInputHash: v.optional(v.string()),
  inferredAt: v.optional(v.number()),
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
  unpublishedSlugReservedUntil: v.optional(v.number()),
  unpublishedSlugReleasedAt: v.optional(v.number()),
  unpublishedOriginalSlug: v.optional(v.string()),
  reportCount: v.optional(v.number()),
  lastReportedAt: v.optional(v.number()),
  batch: v.optional(v.string()),
  statsDownloads: v.optional(v.number()),
  statsStars: v.optional(v.number()),
  statsInstallsCurrent: v.optional(v.number()),
  statsInstallsAllTime: v.optional(v.number()),
  installBackfill: v.optional(
    v.object({
      modelVersion: v.string(),
      totalDownloads: v.number(),
      pendingSkillDocDownloads: v.number(),
      previousInstallsAllTime: v.number(),
      targetInstallsAllTime: v.number(),
      estimatedBackfilledInstalls: v.number(),
      cleanWindowStartDay: v.number(),
      cleanWindowEndDay: v.number(),
      cleanDownloads: v.number(),
      cleanInstalls: v.number(),
      globalCleanRate: v.number(),
      priorDownloads: v.number(),
      minimumCleanDownloads: v.number(),
      maxSmoothedRate: v.number(),
      smoothedRate: v.number(),
      pendingSkillDocInstallsAllTime: v.number(),
      appliedAt: v.number(),
    }),
  ),
  downloadBackfill: v.optional(
    v.object({
      modelVersion: v.string(),
      sourceRepo: v.string(),
      basis: v.literal("public-hosted-downloads-per-published-week"),
      baselineCollectedAt: v.number(),
      baselinePublicHostedSkillCount: v.number(),
      baselinePublicHostedDownloads: v.number(),
      baselinePublicHostedSkillWeeks: v.number(),
      baselineAverageDownloadsPerSkillWeek: v.number(),
      publishedAt: v.number(),
      publishedWeeks: v.number(),
      previousDownloads: v.number(),
      targetDownloads: v.number(),
      estimatedBackfilledDownloads: v.number(),
      pendingSkillDocDownloads: v.number(),
      appliedAt: v.number(),
    }),
  ),
  stats: statsValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_slug", ["slug"])
  .index("by_owner", ["ownerUserId"])
  .index("by_owner_active_updated", ["ownerUserId", "softDeletedAt", "updatedAt"])
  .index("by_owner_publisher", ["ownerPublisherId"])
  .index("by_owner_slug", ["ownerUserId", "slug"])
  .index("by_owner_publisher_slug", ["ownerPublisherId", "slug"])
  .index("by_owner_publisher_active_updated", ["ownerPublisherId", "softDeletedAt", "updatedAt"])
  .index("by_owner_publisher_active_downloads", [
    "ownerPublisherId",
    "softDeletedAt",
    "statsDownloads",
    "updatedAt",
  ])
  .index("by_owner_publisher_active_installs", [
    "ownerPublisherId",
    "softDeletedAt",
    "statsInstallsAllTime",
    "updatedAt",
  ])
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
  .index("by_github_source", ["githubSourceId"])
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
  ownerPublisherId: v.optional(v.id("publishers")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_slug", ["slug"])
  .index("by_skill", ["skillId"])
  .index("by_owner", ["ownerUserId"])
  .index("by_owner_publisher", ["ownerPublisherId"])
  .index("by_owner_slug", ["ownerUserId", "slug"])
  .index("by_owner_publisher_slug", ["ownerPublisherId", "slug"]);

const skillVersions = defineTable({
  skillId: v.id("skills"),
  version: v.string(),
  fingerprint: v.optional(v.string()),
  sourceProvenance: v.optional(
    v.object({
      kind: v.literal("github"),
      url: v.string(),
      repo: v.string(),
      ref: v.string(),
      commit: v.string(),
      path: v.optional(v.string()),
      importedAt: v.number(),
    }),
  ),
  changelog: v.string(),
  changelogSource: v.optional(v.union(v.literal("auto"), v.literal("user"))),
  icon: v.optional(v.string()),
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
  ownerDeletedAt: v.optional(v.number()),
  ownerDeletedBy: v.optional(v.id("users")),
  manualRevocation: v.optional(
    v.object({
      reason: v.string(),
      reviewerUserId: v.id("users"),
      revokedAt: v.number(),
    }),
  ),
  sha256hash: v.optional(v.string()),
  vtAnalysis: v.optional(vtAnalysisValidator),
  skillSpectorAnalysis: v.optional(skillSpectorAnalysisValidator),
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
      agenticRiskFindings: v.optional(v.array(llmAgenticRiskFindingValidator)),
      riskSummary: v.optional(
        v.object({
          abnormal_behavior_control: llmRiskSummaryBucketValidator,
          permission_boundary: llmRiskSummaryBucketValidator,
          sensitive_data_protection: llmRiskSummaryBucketValidator,
        }),
      ),
      model: v.optional(v.string()),
      checkedAt: v.number(),
    }),
  ),
  depRegistryAnalysis: v.optional(depRegistryAnalysisValidator),
  depRegistryScanStatus: v.optional(depRegistryStatusValidator),
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
  .index("by_skill_active_created", ["skillId", "softDeletedAt", "createdAt"])
  .index("by_active_created", ["softDeletedAt", "createdAt"])
  .index("by_active_vt_status_created", ["softDeletedAt", "vtAnalysis.status", "createdAt"])
  .index("by_sha256hash", ["sha256hash"])
  .index("by_dep_registry_scan_status_and_created", ["depRegistryScanStatus", "createdAt"]);

const publishAttemptStatusValidator = v.union(
  v.literal("pending_checks"),
  v.literal("ready_to_finalize"),
  v.literal("finalizing"),
  v.literal("finalized"),
  v.literal("blocked"),
  v.literal("failed"),
  v.literal("expired"),
);

const publishAttemptCheckStateValidator = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("clean"),
    v.literal("blocked"),
    v.literal("failed"),
  ),
  checkedAt: v.optional(v.number()),
  summary: v.optional(v.string()),
  redactedFindings: v.optional(v.array(v.string())),
});

const publishAttempts = defineTable({
  kind: v.union(v.literal("skill"), v.literal("package")),
  status: publishAttemptStatusValidator,
  userId: v.id("users"),
  ownerUserId: v.optional(v.id("users")),
  ownerPublisherId: v.optional(v.id("publishers")),
  sourceOwnerPublisherId: v.optional(v.id("publishers")),
  slug: v.string(),
  displayName: v.string(),
  version: v.string(),
  idempotencyKey: v.string(),
  artifactFingerprint: v.string(),
  files: packageFilesValidator,
  checks: v.object({
    trufflehog: publishAttemptCheckStateValidator,
    clawscan: publishAttemptCheckStateValidator,
  }),
  skillInsertArgs: v.optional(v.any()),
  packageInsertArgs: v.optional(v.any()),
  followup: v.optional(
    v.object({
      skipWebhook: v.optional(v.boolean()),
      ownerHandle: v.optional(v.string()),
    }),
  ),
  packageFollowup: v.optional(v.any()),
  checkClaimId: v.optional(v.string()),
  checkClaimedAt: v.optional(v.number()),
  checkClaimExpiresAt: v.optional(v.number()),
  checkClaimLastError: v.optional(v.string()),
  finalizationClaimId: v.optional(v.string()),
  finalizationClaimedAt: v.optional(v.number()),
  finalizationClaimExpiresAt: v.optional(v.number()),
  finalizationLastError: v.optional(v.string()),
  result: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
  finalizedAt: v.optional(v.number()),
  blockedAt: v.optional(v.number()),
  failedAt: v.optional(v.number()),
})
  .index("by_idempotency_key", ["idempotencyKey"])
  .index("by_status_and_created", ["status", "createdAt"])
  .index("by_expires_at", ["expiresAt"])
  .index("by_kind_status_slug_version_created", ["kind", "status", "slug", "version", "createdAt"])
  .index("by_user_status_created", ["userId", "status", "createdAt"])
  .index("by_owner_publisher_status_created", ["ownerPublisherId", "status", "createdAt"]);

const skillVersionFingerprints = defineTable({
  skillId: v.id("skills"),
  versionId: v.id("skillVersions"),
  fingerprint: v.string(),
  kind: v.optional(v.union(v.literal("source"), v.literal("generated-bundle"))),
  createdAt: v.number(),
})
  .index("by_version", ["versionId"])
  .index("by_version_kind", ["versionId", "kind"])
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

const packageBadges = defineTable({
  packageId: v.id("packages"),
  kind: v.union(v.literal("highlighted")),
  byUserId: v.id("users"),
  at: v.number(),
})
  .index("by_package", ["packageId"])
  .index("by_package_kind", ["packageId", "kind"])
  .index("by_kind_at", ["kind", "at"]);

const skillEmbeddings = defineTable({
  skillId: v.id("skills"),
  versionId: v.id("skillVersions"),
  ownerId: v.id("users"),
  // Deprecated compatibility field. Ownership lives on skills/search digests;
  // keep this optional until old rows are pruned or migrated away.
  ownerPublisherId: v.optional(v.id("publishers")),
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
  normalizedSlug: v.optional(v.string()),
  normalizedSlugFirstToken: v.optional(v.string()),
  displayName: v.string(),
  normalizedDisplayName: v.optional(v.string()),
  normalizedDisplayNameFirstToken: v.optional(v.string()),
  summary: v.optional(v.string()),
  // Mirrors `skills.icon`. Kept on the digest so card/list hydration paths
  // can render the icon without reading the full skill row.
  icon: v.optional(v.string()),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  ownerHandle: v.optional(v.string()),
  ownerKind: v.optional(v.union(v.literal("user"), v.literal("org"))),
  ownerName: v.optional(v.string()),
  ownerDisplayName: v.optional(v.string()),
  ownerImage: v.optional(v.string()),
  canonicalSkillId: v.optional(v.id("skills")),
  forkOf: forkOfValidator,
  latestVersionId: v.optional(v.id("skillVersions")),
  latestVersionSkillId: v.optional(v.id("skills")),
  // Missing means the rollout backfill has not reached this row. New writes
  // always store an explicit available or unavailable public-version state.
  publicVersion: v.optional(publicBrowseVersionStateValidator),
  installKind: v.optional(v.literal("github")),
  githubHasSkillCard: v.optional(v.boolean()),
  githubCurrentStatus: v.optional(githubSkillCurrentStatusValidator),
  githubScanStatus: v.optional(githubSkillScanStatusValidator),
  latestVersionSummary: v.optional(
    v.object({
      version: v.string(),
      createdAt: v.number(),
      changelog: v.string(),
      changelogSource: v.optional(v.union(v.literal("auto"), v.literal("user"))),
      description: v.optional(v.string()),
      clawdis: v.optional(v.any()),
    }),
  ),
  tags: v.record(v.string(), v.id("skillVersions")),
  categories: v.optional(v.array(v.string())),
  topics: v.optional(v.array(v.string())),
  badges: badgesValidator,
  stats: statsValidator,
  statsDownloads: v.optional(v.number()),
  statsStars: v.optional(v.number()),
  statsInstallsCurrent: v.optional(v.number()),
  statsInstallsAllTime: v.optional(v.number()),
  recommendedScore: v.optional(v.number()),
  recommendedScoreVersion: v.optional(v.number()),
  softDeletedAt: v.optional(v.number()),
  moderationStatus: moderationStatusValidator,
  moderationFlags: v.optional(v.array(v.string())),
  moderationVerdict: v.optional(
    v.union(v.literal("clean"), v.literal("suspicious"), v.literal("malicious")),
  ),
  moderationReason: v.optional(v.string()),
  isSuspicious: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_active_updated", ["softDeletedAt", "updatedAt"])
  .index("by_active_created", ["softDeletedAt", "createdAt"])
  .index("by_active_name", ["softDeletedAt", "displayName"])
  .index("by_active_normalized_slug", ["softDeletedAt", "normalizedSlug"])
  .index("by_active_normalized_display_name", ["softDeletedAt", "normalizedDisplayName"])
  .index("by_active_normalized_slug_first_token", ["softDeletedAt", "normalizedSlugFirstToken"])
  .index("by_active_normalized_display_name_first_token", [
    "softDeletedAt",
    "normalizedDisplayNameFirstToken",
  ])
  .index("by_active_stats_downloads", ["softDeletedAt", "statsDownloads", "updatedAt"])
  .index("by_active_stats_stars", ["softDeletedAt", "statsStars", "updatedAt"])
  .index("by_active_stats_installs_all_time", [
    "softDeletedAt",
    "statsInstallsAllTime",
    "updatedAt",
  ])
  .index("by_active_recommended_rank", [
    "softDeletedAt",
    "statsStars",
    "statsDownloads",
    "updatedAt",
  ])
  .index("by_active_recommended_score", ["softDeletedAt", "recommendedScore", "updatedAt"])
  .index("by_active_recommended_score_version", ["softDeletedAt", "recommendedScoreVersion"])
  .index("by_nonsuspicious_updated", ["softDeletedAt", "isSuspicious", "updatedAt"])
  .index("by_nonsuspicious_created", ["softDeletedAt", "isSuspicious", "createdAt"])
  .index("by_nonsuspicious_name", ["softDeletedAt", "isSuspicious", "displayName"])
  .index("by_nonsuspicious_normalized_slug", ["softDeletedAt", "isSuspicious", "normalizedSlug"])
  .index("by_nonsuspicious_normalized_display_name", [
    "softDeletedAt",
    "isSuspicious",
    "normalizedDisplayName",
  ])
  .index("by_nonsuspicious_normalized_slug_first_token", [
    "softDeletedAt",
    "isSuspicious",
    "normalizedSlugFirstToken",
  ])
  .index("by_nonsuspicious_normalized_display_name_first_token", [
    "softDeletedAt",
    "isSuspicious",
    "normalizedDisplayNameFirstToken",
  ])
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
  ])
  .index("by_nonsuspicious_recommended_rank", [
    "softDeletedAt",
    "isSuspicious",
    "statsStars",
    "statsDownloads",
    "updatedAt",
  ])
  .index("by_nonsuspicious_recommended_score", [
    "softDeletedAt",
    "isSuspicious",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_nonsuspicious_recommended_score_version", [
    "softDeletedAt",
    "isSuspicious",
    "recommendedScoreVersion",
  ])
  .searchIndex("search_by_display_name", {
    searchField: "displayName",
    filterFields: ["softDeletedAt", "isSuspicious"],
  })
  .searchIndex("search_by_slug", {
    searchField: "slug",
    filterFields: ["softDeletedAt", "isSuspicious"],
  });

const curatedSkillSearchDigest = defineTable({
  skillId: v.id("skills"),
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  categories: v.optional(v.array(v.string())),
  topics: v.optional(v.array(v.string())),
  statsDownloads: v.optional(v.number()),
  statsStars: v.optional(v.number()),
  statsInstallsAllTime: v.optional(v.number()),
  recommendedScore: v.optional(v.number()),
  softDeletedAt: v.optional(v.number()),
  isSuspicious: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_active_updated", ["softDeletedAt", "updatedAt"])
  .index("by_active_created", ["softDeletedAt", "createdAt"])
  .index("by_active_name", ["softDeletedAt", "displayName"])
  .index("by_active_downloads", ["softDeletedAt", "statsDownloads", "updatedAt"])
  .index("by_active_stars", ["softDeletedAt", "statsStars", "updatedAt"])
  .index("by_active_installs", ["softDeletedAt", "statsInstallsAllTime", "updatedAt"])
  .index("by_active_recommended_score", ["softDeletedAt", "recommendedScore", "updatedAt"])
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
  ])
  .index("by_nonsuspicious_recommended_score", [
    "softDeletedAt",
    "isSuspicious",
    "recommendedScore",
    "updatedAt",
  ]);

const skillTopicSearchDigest = defineTable({
  skillId: v.id("skills"),
  topic: v.string(),
  softDeletedAt: v.optional(v.number()),
  isSuspicious: v.optional(v.boolean()),
  normalizedDisplayName: v.optional(v.string()),
  statsDownloads: v.optional(v.number()),
  statsStars: v.optional(v.number()),
  statsInstallsAllTime: v.optional(v.number()),
  recommendedScore: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_skill", ["skillId", "topic"])
  .index("by_active_topic_updated", ["softDeletedAt", "topic", "updatedAt"])
  .index("by_active_topic_created", ["softDeletedAt", "topic", "createdAt", "updatedAt"])
  .index("by_active_topic_name", ["softDeletedAt", "topic", "normalizedDisplayName", "updatedAt"])
  .index("by_active_topic_downloads", ["softDeletedAt", "topic", "statsDownloads", "updatedAt"])
  .index("by_active_topic_stars", ["softDeletedAt", "topic", "statsStars", "updatedAt"])
  .index("by_active_topic_installs", [
    "softDeletedAt",
    "topic",
    "statsInstallsAllTime",
    "updatedAt",
  ])
  .index("by_active_topic_recommended_score", [
    "softDeletedAt",
    "topic",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_nonsuspicious_topic_updated", ["softDeletedAt", "isSuspicious", "topic", "updatedAt"])
  .index("by_nonsuspicious_topic_created", [
    "softDeletedAt",
    "isSuspicious",
    "topic",
    "createdAt",
    "updatedAt",
  ])
  .index("by_nonsuspicious_topic_name", [
    "softDeletedAt",
    "isSuspicious",
    "topic",
    "normalizedDisplayName",
    "updatedAt",
  ])
  .index("by_nonsuspicious_topic_downloads", [
    "softDeletedAt",
    "isSuspicious",
    "topic",
    "statsDownloads",
    "updatedAt",
  ])
  .index("by_nonsuspicious_topic_stars", [
    "softDeletedAt",
    "isSuspicious",
    "topic",
    "statsStars",
    "updatedAt",
  ])
  .index("by_nonsuspicious_topic_installs", [
    "softDeletedAt",
    "isSuspicious",
    "topic",
    "statsInstallsAllTime",
    "updatedAt",
  ])
  .index("by_nonsuspicious_topic_recommended_score", [
    "softDeletedAt",
    "isSuspicious",
    "topic",
    "recommendedScore",
    "updatedAt",
  ]);

const packages = defineTable({
  name: v.string(),
  normalizedName: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  icon: v.optional(v.string()),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  family: packageFamilyValidator,
  channel: packageChannelValidator,
  isOfficial: v.boolean(),
  runtimeId: v.optional(v.string()),
  sourceRepo: v.optional(v.string()),
  latestReleaseId: v.optional(v.id("packageReleases")),
  latestVersionSummary: v.optional(
    v.object({
      version: v.string(),
      createdAt: v.number(),
      changelog: v.string(),
      icon: v.optional(v.string()),
      compatibility: packageCompatibilityValidator,
      verification: packageVerificationValidator,
      artifact: packageArtifactSummaryValidator,
    }),
  ),
  tags: v.record(v.string(), v.id("packageReleases")),
  categories: v.optional(v.array(v.string())),
  topics: v.optional(v.array(v.string())),
  inferredCategories: v.optional(v.array(v.string())),
  inferredTopics: v.optional(v.array(v.string())),
  inferredFromReleaseId: v.optional(v.id("packageReleases")),
  inferredCategoryConfidence: v.optional(catalogClassificationConfidenceValidator),
  inferredTopicConfidence: v.optional(catalogClassificationConfidenceValidator),
  inferredClassifierVersion: v.optional(v.string()),
  inferredTopicClassifierVersion: v.optional(v.string()),
  inferredInputHash: v.optional(v.string()),
  inferredTopicInputHash: v.optional(v.string()),
  inferredAt: v.optional(v.number()),
  compatibility: packageCompatibilityValidator,
  verification: packageVerificationValidator,
  scanStatus: packageScanStatusValidator,
  stats: packageStatsValidator,
  recommendedScore: v.optional(v.number()),
  recommendedScoreVersion: v.optional(v.number()),
  reportCount: v.optional(v.number()),
  lastReportedAt: v.optional(v.number()),
  softDeletedAt: v.optional(v.number()),
  softDeletedReason: v.optional(
    v.union(
      v.literal("user.banned"),
      v.literal("user.deactivated"),
      v.literal("publisher.deleted"),
    ),
  ),
  softDeletedBy: v.optional(v.id("users")),
  softDeletedByRole: v.optional(
    v.union(v.literal("admin"), v.literal("moderator"), v.literal("user")),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_name", ["normalizedName"])
  .index("by_owner", ["ownerUserId"])
  .index("by_owner_active_updated", ["ownerUserId", "softDeletedAt", "updatedAt"])
  .index("by_owner_publisher", ["ownerPublisherId"])
  .index("by_owner_publisher_active_updated", ["ownerPublisherId", "softDeletedAt", "updatedAt"])
  .index("by_owner_publisher_active_downloads", [
    "ownerPublisherId",
    "softDeletedAt",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_owner_publisher_active_installs", [
    "ownerPublisherId",
    "softDeletedAt",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_family_updated", ["family", "updatedAt"])
  .index("by_family_channel_updated", ["family", "channel", "updatedAt"])
  .index("by_family_official_updated", ["family", "isOfficial", "updatedAt"])
  .index("by_runtime_id", ["runtimeId"])
  .index("by_active_updated", ["softDeletedAt", "updatedAt"])
  .index("by_active_downloads", ["softDeletedAt", "stats.downloads", "updatedAt"])
  .index("by_active_family_downloads", ["softDeletedAt", "family", "stats.downloads", "updatedAt"])
  .index("by_active_family_official_downloads", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_installs", ["softDeletedAt", "stats.installs", "updatedAt"])
  .index("by_active_family_installs", ["softDeletedAt", "family", "stats.installs", "updatedAt"])
  .index("by_active_family_official_installs", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_active_recommended_rank", [
    "softDeletedAt",
    "stats.stars",
    "stats.downloads",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_active_family_recommended_rank", [
    "softDeletedAt",
    "family",
    "stats.stars",
    "stats.downloads",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_active_recommended_score", ["softDeletedAt", "recommendedScore", "updatedAt"])
  .index("by_active_recommended_score_version", ["softDeletedAt", "recommendedScoreVersion"])
  .index("by_active_family_recommended_score", [
    "softDeletedAt",
    "family",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_active_family_recommended_score_version", [
    "softDeletedAt",
    "family",
    "recommendedScoreVersion",
  ]);

const packageReleases = defineTable({
  packageId: v.id("packages"),
  version: v.string(),
  changelog: v.string(),
  summary: v.optional(v.string()),
  icon: v.optional(v.string()),
  distTags: v.array(v.string()),
  files: packageFilesValidator,
  integritySha256: v.string(),
  artifactKind: v.optional(v.union(v.literal("legacy-zip"), v.literal("npm-pack"))),
  clawpackStorageId: v.optional(v.id("_storage")),
  clawpackSha256: v.optional(v.string()),
  clawpackSize: v.optional(v.number()),
  clawpackFormat: v.optional(v.literal("tgz")),
  npmIntegrity: v.optional(v.string()),
  npmShasum: v.optional(v.string()),
  npmTarballName: v.optional(v.string()),
  npmUnpackedSize: v.optional(v.number()),
  npmFileCount: v.optional(v.number()),
  extractedPackageJson: v.optional(v.any()),
  extractedPluginManifest: v.optional(v.any()),
  normalizedBundleManifest: v.optional(v.any()),
  pluginManifestSummary: v.optional(pluginManifestSummaryValidator),
  compatibility: packageCompatibilityValidator,
  runtimeId: v.optional(v.string()),
  sourceRepo: v.optional(v.string()),
  verification: packageVerificationValidator,
  // Deprecated compatibility hash for exact /download ZIP bytes; use artifact.sha256 for installs.
  sha256hash: v.optional(v.string()),
  vtAnalysis: v.optional(vtAnalysisValidator),
  skillSpectorAnalysis: v.optional(skillSpectorAnalysisValidator),
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
      agenticRiskFindings: v.optional(v.array(llmAgenticRiskFindingValidator)),
      riskSummary: v.optional(
        v.object({
          abnormal_behavior_control: llmRiskSummaryBucketValidator,
          permission_boundary: llmRiskSummaryBucketValidator,
          sensitive_data_protection: llmRiskSummaryBucketValidator,
        }),
      ),
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
  manualModeration: v.optional(packageReleaseModerationOverrideValidator),
  source: v.optional(v.any()),
  createdBy: v.id("users"),
  publishActor: packagePublishActorValidator,
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
  ownerDeletedAt: v.optional(v.number()),
  ownerDeletedBy: v.optional(v.id("users")),
})
  .index("by_package", ["packageId"])
  .index("by_package_active_created", ["packageId", "softDeletedAt", "createdAt"])
  .index("by_active_created", ["softDeletedAt", "createdAt"])
  .index("by_package_version", ["packageId", "version"])
  .index("by_sha256hash", ["sha256hash"]);

const catalogClassificationResults = defineTable({
  targetKind: v.union(v.literal("skill"), v.literal("plugin")),
  skillId: v.optional(v.id("skills")),
  packageId: v.optional(v.id("packages")),
  skillVersionId: v.optional(v.id("skillVersions")),
  packageReleaseId: v.optional(v.id("packageReleases")),
  categories: v.array(v.string()),
  topics: v.array(v.string()),
  categoryCandidates: v.array(catalogCategoryCandidateValidator),
  topicCandidates: v.array(catalogTopicCandidateValidator),
  categoryCandidateCount: v.number(),
  topicCandidateCount: v.number(),
  categoryConfidence: catalogClassificationConfidenceValidator,
  topicConfidence: catalogClassificationConfidenceValidator,
  categoryNeedsReview: v.boolean(),
  topicNeedsReview: v.boolean(),
  unknownSignals: v.array(v.string()),
  classifierVersion: v.string(),
  topicClassifierVersion: v.string(),
  inputHash: v.string(),
  topicInputHash: v.string(),
  applyStatus: catalogClassificationApplyStatusValidator,
  error: v.optional(v.string()),
  classifiedAt: v.number(),
  appliedAt: v.optional(v.number()),
})
  .index("by_skill", ["skillId"])
  .index("by_package", ["packageId"])
  .index("by_apply_status", ["applyStatus", "classifiedAt"])
  .index("by_category_confidence", ["categoryConfidence", "classifiedAt"])
  .index("by_topic_confidence", ["topicConfidence", "classifiedAt"]);

const packageInspectorWarnings = defineTable({
  packageId: v.id("packages"),
  releaseId: v.id("packageReleases"),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  packageName: v.string(),
  version: v.string(),
  findingKind: v.optional(v.union(v.literal("warning"), v.literal("error"))),
  scanSource: v.optional(v.union(v.literal("publish"), v.literal("nightly"))),
  inspectorVersion: v.optional(v.string()),
  targetOpenClawVersion: v.optional(v.string()),
  code: v.string(),
  severity: v.optional(v.string()),
  level: v.optional(v.string()),
  issueClass: v.optional(v.string()),
  compatStatus: v.optional(v.string()),
  deprecated: v.optional(v.boolean()),
  message: v.string(),
  evidence: v.optional(v.array(v.string())),
  authorRemediation: v.optional(
    v.object({
      summary: v.string(),
      docsUrl: v.optional(v.string()),
    }),
  ),
  fixture: v.optional(v.string()),
  decision: v.optional(v.string()),
  inspectorFindingId: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_package_created", ["packageId", "createdAt"])
  .index("by_release", ["releaseId"])
  .index("by_release_created", ["releaseId", "createdAt"])
  .index("by_owner_user_created", ["ownerUserId", "createdAt"])
  .index("by_owner_publisher_created", ["ownerPublisherId", "createdAt"]);

const packageInspectorFindingNotifications = defineTable({
  packageId: v.id("packages"),
  releaseId: v.id("packageReleases"),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  packageName: v.string(),
  version: v.string(),
  email: v.string(),
  findingCount: v.number(),
  sentAt: v.number(),
})
  .index("by_release", ["releaseId"])
  .index("by_owner_user_sent", ["ownerUserId", "sentAt"]);

const packageInspectorScanCursors = defineTable({
  name: v.string(),
  cursor: v.optional(v.union(v.string(), v.null())),
  leaseExpiresAt: v.optional(v.number()),
  updatedAt: v.number(),
}).index("by_name", ["name"]);

const securityScanJobs = defineTable({
  targetKind: securityScanTargetKindValidator,
  skillVersionId: v.optional(v.id("skillVersions")),
  packageReleaseId: v.optional(v.id("packageReleases")),
  skillScanRequestId: v.optional(v.id("skillScanRequests")),
  status: securityScanJobStatusValidator,
  source: securityScanJobSourceValidator,
  priority: v.number(),
  hasMaliciousSignal: v.boolean(),
  waitForVtUntil: v.number(),
  nextRunAt: v.number(),
  attempts: v.number(),
  leaseToken: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  workerId: v.optional(v.string()),
  lastError: v.optional(v.string()),
  runId: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_status_and_next_run_at", ["status", "nextRunAt"])
  .index("by_status_source_created_at", ["status", "source", "createdAt"])
  .index("by_status_source_next_run_at", ["status", "source", "nextRunAt"])
  .index("by_status_source_target_kind_created_at", ["status", "source", "targetKind", "createdAt"])
  .index("by_status_and_lease_expires_at", ["status", "leaseExpiresAt"])
  .index("by_status_malicious_signal_next_run_at", ["status", "hasMaliciousSignal", "nextRunAt"])
  .index("by_skill_version", ["skillVersionId"])
  .index("by_package_release", ["packageReleaseId"])
  .index("by_skill_scan_request", ["skillScanRequestId"]);

const securityScanDispatchState = defineTable({
  key: v.string(),
  scheduledToken: v.optional(v.string()),
  scheduledAt: v.optional(v.number()),
  leaseToken: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  lastDispatchAt: v.optional(v.number()),
  lastDispatchStatus: v.optional(
    v.union(v.literal("succeeded"), v.literal("failed"), v.literal("unknown")),
  ),
  lastError: v.optional(v.string()),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

const skillScanRequests = defineTable({
  actorUserId: v.id("users"),
  sourceKind: skillScanRequestSourceKindValidator,
  update: v.boolean(),
  writtenBack: v.boolean(),
  status: securityScanJobStatusValidator,
  securityScanJobId: v.optional(v.id("securityScanJobs")),
  requestedJobSource: v.optional(securityScanJobSourceValidator),
  requestedJobPriority: v.optional(v.number()),
  slug: v.optional(v.string()),
  displayName: v.optional(v.string()),
  version: v.optional(v.string()),
  skillId: v.optional(v.id("skills")),
  skillVersionId: v.optional(v.id("skillVersions")),
  githubSkillScanId: v.optional(v.id("githubSkillScans")),
  files: packageFilesValidator,
  fileChunkCount: v.optional(v.number()),
  fileManifestBytes: v.optional(v.number()),
  parsed: v.optional(
    v.object({
      frontmatter: v.record(v.string(), v.any()),
      metadata: v.optional(v.any()),
      clawdis: v.optional(v.any()),
      moltbot: v.optional(v.any()),
      license: v.optional(v.literal(PLATFORM_SKILL_LICENSE)),
    }),
  ),
  sha256hash: v.optional(v.string()),
  vtAnalysis: v.optional(vtAnalysisValidator),
  skillSpectorAnalysis: v.optional(skillSpectorAnalysisValidator),
  llmAnalysis: v.optional(llmAnalysisValidator),
  staticScan: v.optional(staticScanValidator),
  lastError: v.optional(v.string()),
  runId: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_actor_user_id_and_created_at", ["actorUserId", "createdAt"])
  .index("by_security_scan_job_id", ["securityScanJobId"])
  .index("by_skill_version_id_and_created_at", ["skillVersionId", "createdAt"])
  .index("by_expires_at", ["expiresAt"]);

const skillScanRequestFileChunks = defineTable({
  skillScanRequestId: v.id("skillScanRequests"),
  chunkIndex: v.number(),
  files: packageFilesValidator,
  createdAt: v.number(),
}).index("by_skill_scan_request_id_and_chunk_index", ["skillScanRequestId", "chunkIndex"]);

const skillCardGenerationJobs = defineTable({
  skillId: v.id("skills"),
  skillVersionId: v.id("skillVersions"),
  status: skillCardGenerationJobStatusValidator,
  source: skillCardGenerationJobSourceValidator,
  priority: v.number(),
  nextRunAt: v.number(),
  attempts: v.number(),
  leaseToken: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  workerId: v.optional(v.string()),
  lastError: v.optional(v.string()),
  runId: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_status_and_next_run_at", ["status", "nextRunAt"])
  .index("by_status_and_lease_expires_at", ["status", "leaseExpiresAt"])
  .index("by_skill", ["skillId"])
  .index("by_skill_version_status", ["skillVersionId", "status"])
  .index("by_skill_version", ["skillVersionId"]);

const packageStatEvents = defineTable({
  packageId: v.id("packages"),
  kind: v.union(v.literal("download"), v.literal("install")),
  occurredAt: v.number(),
  processedAt: v.optional(v.number()),
})
  .index("by_unprocessed", ["processedAt"])
  .index("by_package", ["packageId"]);

const packageDailyStats = defineTable({
  packageId: v.id("packages"),
  day: v.number(),
  downloads: v.number(),
  installs: v.number(),
  updatedAt: v.number(),
})
  .index("by_package_day", ["packageId", "day"])
  .index("by_day", ["day"]);

const packageLeaderboards = defineTable({
  kind: v.string(),
  generatedAt: v.number(),
  rangeStartDay: v.number(),
  rangeEndDay: v.number(),
  items: v.array(
    v.object({
      packageId: v.id("packages"),
      score: v.number(),
      installs: v.number(),
      downloads: v.number(),
    }),
  ),
}).index("by_kind", ["kind", "generatedAt"]);

const packageTrustedPublishers = defineTable({
  packageId: v.id("packages"),
  provider: v.literal("github-actions"),
  repository: v.string(),
  repositoryId: v.string(),
  repositoryOwner: v.string(),
  repositoryOwnerId: v.string(),
  workflowFilename: v.string(),
  environment: v.optional(v.string()),
  createdByUserId: v.id("users"),
  updatedByUserId: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_package", ["packageId"])
  .index("by_repository", ["repository", "workflowFilename"]);

const packagePublishTokens = defineTable({
  packageId: v.id("packages"),
  version: v.string(),
  prefix: v.string(),
  tokenHash: v.string(),
  provider: v.literal("github-actions"),
  repository: v.string(),
  repositoryId: v.string(),
  repositoryOwner: v.string(),
  repositoryOwnerId: v.string(),
  workflowFilename: v.string(),
  environment: v.optional(v.string()),
  runId: v.string(),
  runAttempt: v.string(),
  sha: v.string(),
  ref: v.string(),
  refType: v.optional(v.string()),
  actor: v.optional(v.string()),
  actorId: v.optional(v.string()),
  expiresAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_hash", ["tokenHash"])
  .index("by_package", ["packageId", "version", "createdAt"])
  .index("by_package_revoked_created", ["packageId", "revokedAt", "createdAt"]);

const packagePublishUploadTickets = defineTable({
  kind: v.union(v.literal("user"), v.literal("github-actions")),
  userId: v.optional(v.id("users")),
  publishTokenId: v.optional(v.id("packagePublishTokens")),
  createdAt: v.number(),
  expiresAt: v.number(),
  usedAt: v.optional(v.number()),
  storageId: v.optional(v.id("_storage")),
}).index("by_publish_token", ["publishTokenId"]);

const packageSearchDigest = defineTable({
  packageId: v.id("packages"),
  name: v.string(),
  normalizedName: v.string(),
  displayName: v.string(),
  family: packageFamilyValidator,
  channel: packageChannelValidator,
  isOfficial: v.boolean(),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  ownerHandle: v.optional(v.string()),
  ownerKind: v.optional(v.union(v.literal("user"), v.literal("org"))),
  summary: v.optional(v.string()),
  icon: v.optional(v.string()),
  latestVersion: v.optional(v.string()),
  runtimeId: v.optional(v.string()),
  categories: v.optional(v.array(v.string())),
  topics: v.optional(v.array(v.string())),
  pluginCategoryTags: v.optional(v.array(v.string())),
  verificationTier: v.optional(packageVerificationTierValidator),
  stats: v.optional(packageStatsValidator),
  recommendedScore: v.optional(v.number()),
  recommendedScoreVersion: v.optional(v.number()),
  scanStatus: packageScanStatusValidator,
  softDeletedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_package", ["packageId"])
  .index("by_active_updated", ["softDeletedAt", "updatedAt"])
  .index("by_active_channel_updated", ["softDeletedAt", "channel", "updatedAt"])
  .index("by_active_official_updated", ["softDeletedAt", "isOfficial", "updatedAt"])
  .index("by_active_channel_official_updated", [
    "softDeletedAt",
    "channel",
    "isOfficial",
    "updatedAt",
  ])
  .index("by_active_family_updated", ["softDeletedAt", "family", "updatedAt"])
  .index("by_active_family_channel_updated", ["softDeletedAt", "family", "channel", "updatedAt"])
  .index("by_active_family_official_updated", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "updatedAt",
  ])
  .index("by_active_normalized_name", ["softDeletedAt", "normalizedName", "updatedAt"])
  .index("by_active_runtime_id", ["softDeletedAt", "runtimeId", "updatedAt"])
  .index("by_active_owner_handle", ["softDeletedAt", "ownerHandle", "updatedAt"])
  .index("by_active_name", ["softDeletedAt", "displayName"])
  .searchIndex("search_by_display_name", {
    searchField: "displayName",
    filterFields: ["softDeletedAt"],
  });

const packageTopicSearchDigest = defineTable({
  packageId: v.id("packages"),
  name: v.string(),
  normalizedName: v.string(),
  displayName: v.string(),
  family: packageFamilyValidator,
  channel: packageChannelValidator,
  isOfficial: v.boolean(),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  ownerHandle: v.optional(v.string()),
  ownerKind: v.optional(v.union(v.literal("user"), v.literal("org"))),
  summary: v.optional(v.string()),
  icon: v.optional(v.string()),
  latestVersion: v.optional(v.string()),
  runtimeId: v.optional(v.string()),
  categories: v.optional(v.array(v.string())),
  topics: v.optional(v.array(v.string())),
  pluginCategoryTags: v.optional(v.array(v.string())),
  topic: v.string(),
  verificationTier: v.optional(packageVerificationTierValidator),
  stats: v.optional(packageStatsValidator),
  recommendedScore: v.optional(v.number()),
  recommendedScoreVersion: v.optional(v.number()),
  scanStatus: packageScanStatusValidator,
  softDeletedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_package", ["packageId", "topic"])
  .index("by_active_topic_updated", ["softDeletedAt", "topic", "updatedAt"])
  .index("by_active_topic_downloads", ["softDeletedAt", "topic", "stats.downloads", "updatedAt"])
  .index("by_active_topic_installs", ["softDeletedAt", "topic", "stats.installs", "updatedAt"])
  .index("by_active_topic_recommended_score", [
    "softDeletedAt",
    "topic",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_active_official_topic_downloads", [
    "softDeletedAt",
    "isOfficial",
    "topic",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_family_topic_downloads", [
    "softDeletedAt",
    "family",
    "topic",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_channel_topic_downloads", [
    "softDeletedAt",
    "channel",
    "topic",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_family_channel_topic_downloads", [
    "softDeletedAt",
    "family",
    "channel",
    "topic",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_family_official_topic_downloads", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "topic",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_channel_official_topic_downloads", [
    "softDeletedAt",
    "channel",
    "isOfficial",
    "topic",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_family_channel_official_topic_downloads", [
    "softDeletedAt",
    "family",
    "channel",
    "isOfficial",
    "topic",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_official_topic_installs", [
    "softDeletedAt",
    "isOfficial",
    "topic",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_active_official_topic_recommended_score", [
    "softDeletedAt",
    "isOfficial",
    "topic",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_active_family_topic_updated", ["softDeletedAt", "family", "topic", "updatedAt"])
  .index("by_active_channel_topic_updated", ["softDeletedAt", "channel", "topic", "updatedAt"])
  .index("by_active_official_topic_updated", ["softDeletedAt", "isOfficial", "topic", "updatedAt"])
  .index("by_active_family_channel_topic_updated", [
    "softDeletedAt",
    "family",
    "channel",
    "topic",
    "updatedAt",
  ])
  .index("by_active_family_official_topic_updated", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "topic",
    "updatedAt",
  ])
  .index("by_active_channel_official_topic_updated", [
    "softDeletedAt",
    "channel",
    "isOfficial",
    "topic",
    "updatedAt",
  ]);

const packagePluginCategorySearchDigest = defineTable({
  packageId: v.id("packages"),
  name: v.string(),
  normalizedName: v.string(),
  displayName: v.string(),
  family: packageFamilyValidator,
  channel: packageChannelValidator,
  isOfficial: v.boolean(),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  ownerHandle: v.optional(v.string()),
  ownerKind: v.optional(v.union(v.literal("user"), v.literal("org"))),
  summary: v.optional(v.string()),
  icon: v.optional(v.string()),
  latestVersion: v.optional(v.string()),
  runtimeId: v.optional(v.string()),
  categories: v.optional(v.array(v.string())),
  topics: v.optional(v.array(v.string())),
  pluginCategoryTags: v.optional(v.array(v.string())),
  pluginCategory: v.string(),
  verificationTier: v.optional(packageVerificationTierValidator),
  stats: v.optional(packageStatsValidator),
  recommendedScore: v.optional(v.number()),
  recommendedScoreVersion: v.optional(v.number()),
  scanStatus: packageScanStatusValidator,
  softDeletedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_package", ["packageId", "pluginCategory"])
  .index("by_active_category_updated", ["softDeletedAt", "pluginCategory", "updatedAt"])
  .index("by_active_category_downloads", [
    "softDeletedAt",
    "pluginCategory",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_category_installs", [
    "softDeletedAt",
    "pluginCategory",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_active_category_recommended_score", [
    "softDeletedAt",
    "pluginCategory",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_active_family_category_downloads", [
    "softDeletedAt",
    "family",
    "pluginCategory",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_channel_category_downloads", [
    "softDeletedAt",
    "channel",
    "pluginCategory",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_family_channel_category_downloads", [
    "softDeletedAt",
    "family",
    "channel",
    "pluginCategory",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_family_category_installs", [
    "softDeletedAt",
    "family",
    "pluginCategory",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_active_family_category_recommended_score", [
    "softDeletedAt",
    "family",
    "pluginCategory",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_active_official_category_downloads", [
    "softDeletedAt",
    "isOfficial",
    "pluginCategory",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_official_category_installs", [
    "softDeletedAt",
    "isOfficial",
    "pluginCategory",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_active_official_category_recommended_score", [
    "softDeletedAt",
    "isOfficial",
    "pluginCategory",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_active_family_official_category_downloads", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "pluginCategory",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_channel_official_category_downloads", [
    "softDeletedAt",
    "channel",
    "isOfficial",
    "pluginCategory",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_family_channel_official_category_downloads", [
    "softDeletedAt",
    "family",
    "channel",
    "isOfficial",
    "pluginCategory",
    "stats.downloads",
    "updatedAt",
  ])
  .index("by_active_family_official_category_installs", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "pluginCategory",
    "stats.installs",
    "updatedAt",
  ])
  .index("by_active_family_official_category_recommended_score", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "pluginCategory",
    "recommendedScore",
    "updatedAt",
  ])
  .index("by_active_family_category_updated", [
    "softDeletedAt",
    "family",
    "pluginCategory",
    "updatedAt",
  ])
  .index("by_active_channel_category_updated", [
    "softDeletedAt",
    "channel",
    "pluginCategory",
    "updatedAt",
  ])
  .index("by_active_official_category_updated", [
    "softDeletedAt",
    "isOfficial",
    "pluginCategory",
    "updatedAt",
  ])
  .index("by_active_family_channel_category_updated", [
    "softDeletedAt",
    "family",
    "channel",
    "pluginCategory",
    "updatedAt",
  ])
  .index("by_active_family_official_category_updated", [
    "softDeletedAt",
    "family",
    "isOfficial",
    "pluginCategory",
    "updatedAt",
  ])
  .index("by_active_channel_official_category_updated", [
    "softDeletedAt",
    "channel",
    "isOfficial",
    "pluginCategory",
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
  activePluginsCount: v.optional(v.number()),
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
  .index("by_skill", ["skillId"])
  .index("by_skill_processed", ["skillId", "processedAt"]);

const skillStatUpdateCursors = defineTable({
  key: v.string(),
  cursorCreationTime: v.optional(v.number()),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

const skillStatDocSyncLeases = defineTable({
  key: v.string(),
  leaseOwner: v.string(),
  leaseExpiresAt: v.number(),
  updatedAt: v.number(),
  lastStartedAt: v.optional(v.number()),
  lastFinishedAt: v.optional(v.number()),
  lastProcessedAt: v.optional(v.number()),
  lastProcessedCount: v.optional(v.number()),
  lastError: v.optional(v.string()),
  lastErrorAt: v.optional(v.number()),
  lastErrorProcessedCount: v.optional(v.number()),
}).index("by_key", ["key"]);

const skillReports = defineTable({
  skillId: v.id("skills"),
  skillVersionId: v.optional(v.id("skillVersions")),
  version: v.optional(v.string()),
  userId: v.id("users"),
  reason: v.optional(v.string()),
  status: v.optional(
    v.union(
      v.literal("open"),
      v.literal("confirmed"),
      v.literal("dismissed"),
      v.literal("triaged"),
    ),
  ),
  triagedAt: v.optional(v.number()),
  triagedBy: v.optional(v.id("users")),
  triageNote: v.optional(v.string()),
  actionTaken: v.optional(v.union(v.literal("none"), v.literal("hide"))),
  createdAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_skill_createdAt", ["skillId", "createdAt"])
  .index("by_createdAt", ["createdAt"])
  .index("by_skill_status_createdAt", ["skillId", "status", "createdAt"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_user", ["userId"])
  .index("by_skill_user", ["skillId", "userId"]);

const skillAppeals = defineTable({
  skillId: v.id("skills"),
  skillVersionId: v.optional(v.id("skillVersions")),
  version: v.optional(v.string()),
  userId: v.id("users"),
  message: v.string(),
  status: v.union(v.literal("open"), v.literal("accepted"), v.literal("rejected")),
  resolvedAt: v.optional(v.number()),
  resolvedBy: v.optional(v.id("users")),
  resolutionNote: v.optional(v.string()),
  actionTaken: v.optional(v.union(v.literal("none"), v.literal("restore"))),
  createdAt: v.number(),
})
  .index("by_skill_status_createdAt", ["skillId", "status", "createdAt"])
  .index("by_createdAt", ["createdAt"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_user_createdAt", ["userId", "createdAt"]);

const skillModerationEventLogs = defineTable({
  kind: v.union(v.literal("report"), v.literal("appeal")),
  reportId: v.optional(v.id("skillReports")),
  appealId: v.optional(v.id("skillAppeals")),
  actorUserId: v.id("users"),
  action: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_report_createdAt", ["reportId", "createdAt"])
  .index("by_appeal_createdAt", ["appealId", "createdAt"])
  .index("by_actor_createdAt", ["actorUserId", "createdAt"]);

const packageReports = defineTable({
  packageId: v.id("packages"),
  releaseId: v.optional(v.id("packageReleases")),
  version: v.optional(v.string()),
  userId: v.id("users"),
  reason: v.optional(v.string()),
  status: v.union(
    v.literal("open"),
    v.literal("confirmed"),
    v.literal("dismissed"),
    v.literal("triaged"),
  ),
  triagedAt: v.optional(v.number()),
  triagedBy: v.optional(v.id("users")),
  triageNote: v.optional(v.string()),
  actionTaken: v.optional(v.union(v.literal("none"), v.literal("quarantine"), v.literal("revoke"))),
  createdAt: v.number(),
})
  .index("by_package", ["packageId"])
  .index("by_package_createdAt", ["packageId", "createdAt"])
  .index("by_release", ["releaseId"])
  .index("by_createdAt", ["createdAt"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_user", ["userId"])
  .index("by_package_user", ["packageId", "userId"]);

const packageAppeals = defineTable({
  packageId: v.id("packages"),
  releaseId: v.id("packageReleases"),
  version: v.string(),
  userId: v.id("users"),
  message: v.string(),
  status: v.union(v.literal("open"), v.literal("accepted"), v.literal("rejected")),
  resolvedAt: v.optional(v.number()),
  resolvedBy: v.optional(v.id("users")),
  resolutionNote: v.optional(v.string()),
  actionTaken: v.optional(v.union(v.literal("none"), v.literal("approve"))),
  createdAt: v.number(),
})
  .index("by_package", ["packageId"])
  .index("by_release_status_createdAt", ["releaseId", "status", "createdAt"])
  .index("by_createdAt", ["createdAt"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_user_createdAt", ["userId", "createdAt"]);

const packageModerationEventLogs = defineTable({
  kind: v.union(v.literal("report"), v.literal("appeal")),
  reportId: v.optional(v.id("packageReports")),
  appealId: v.optional(v.id("packageAppeals")),
  actorUserId: v.id("users"),
  action: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_report_createdAt", ["reportId", "createdAt"])
  .index("by_appeal_createdAt", ["appealId", "createdAt"])
  .index("by_actor_createdAt", ["actorUserId", "createdAt"]);

const officialPluginMigrations = defineTable({
  bundledPluginId: v.string(),
  packageName: v.string(),
  packageId: v.optional(v.id("packages")),
  owner: v.optional(v.string()),
  sourceRepo: v.optional(v.string()),
  sourcePath: v.optional(v.string()),
  sourceCommit: v.optional(v.string()),
  phase: v.union(
    v.literal("planned"),
    v.literal("published"),
    v.literal("clawpack-ready"),
    v.literal("legacy-zip-only"),
    v.literal("metadata-ready"),
    v.literal("blocked"),
    v.literal("ready-for-openclaw"),
  ),
  blockers: v.array(v.string()),
  hostTargetsComplete: v.boolean(),
  scanClean: v.boolean(),
  moderationApproved: v.boolean(),
  runtimeBundlesReady: v.boolean(),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_bundled_plugin", ["bundledPluginId"])
  .index("by_package_name", ["packageName"])
  .index("by_phase_updatedAt", ["phase", "updatedAt"])
  .index("by_updatedAt", ["updatedAt"]);

const catalogFeedPublications = defineTable({
  feedId: v.string(),
  sequence: v.number(),
  generatedAt: v.string(),
  expiresAt: v.string(),
  payload: v.string(),
  payloadSha256: v.string(),
  publishedAt: v.number(),
}).index("by_feed", ["feedId"]);

const publisherFeedPublications = defineTable({
  publisherId: v.id("publishers"),
  feedId: v.string(),
  sequence: v.number(),
  generatedAt: v.string(),
  handle: v.union(v.string(), v.null()),
  displayName: v.string(),
  entries: v.array(
    v.object({
      kind: v.union(v.literal("skill"), v.literal("plugin")),
      id: v.string(),
      name: v.string(),
      displayName: v.string(),
      summary: v.union(v.string(), v.null()),
      url: v.string(),
      updatedAt: v.number(),
    }),
  ),
  contentKey: v.string(),
  publishedAt: v.number(),
}).index("by_publisher", ["publisherId"]);

const stars = defineTable({
  skillId: v.id("skills"),
  userId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_skill", ["skillId"])
  .index("by_user", ["userId"])
  .index("by_skill_user", ["skillId", "userId"]);

const promotionStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("ended"),
);

// Declarative activation payload consumed by the OpenClaw CLI. The CLI
// validates authChoiceId/pluginNames against its local provider catalog and
// never executes anything from these records.
const promotionModelValidator = v.object({
  modelRef: v.string(),
  alias: v.optional(v.string()),
  suggestedDefault: v.optional(v.boolean()),
});

const promotions = defineTable({
  slug: v.string(),
  title: v.string(),
  blurb: v.string(),
  sponsor: v.optional(v.string()),
  status: promotionStatusValidator,
  startsAt: v.number(),
  endsAt: v.number(),
  provider: v.optional(v.string()),
  authChoiceId: v.optional(v.string()),
  pluginNames: v.optional(v.array(v.string())),
  models: v.array(promotionModelValidator),
  signupUrl: v.optional(v.string()),
  docsUrl: v.optional(v.string()),
  launchPageUrl: v.optional(v.string()),
  launchedAt: v.optional(v.number()),
  createdByUserId: v.id("users"),
  updatedByUserId: v.optional(v.id("users")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_slug", ["slug"])
  .index("by_status_endsAt", ["status", "endsAt"]);

const publisherFollows = defineTable({
  followerUserId: v.id("users"),
  publisherId: v.id("publishers"),
  notifications: v.union(v.literal("all"), v.literal("none")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_follower", ["followerUserId", "updatedAt"])
  .index("by_publisher", ["publisherId", "updatedAt"])
  .index("by_follower_publisher", ["followerUserId", "publisherId"]);

const auditLogs = defineTable({
  actorUserId: v.optional(v.id("users")),
  action: v.string(),
  targetType: v.string(),
  targetId: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_actor", ["actorUserId"])
  .index("by_target", ["targetType", "targetId"])
  .index("by_target_action", ["targetType", "targetId", "action"])
  .index("by_target_createdAt", ["targetType", "targetId", "createdAt"]);

const systemSettings = defineTable({
  key: v.literal("publisherAbuseAutobanEnabled"),
  enabled: v.boolean(),
  updatedAt: v.number(),
  updatedByUserId: v.optional(v.id("users")),
}).index("by_key_and_updated_at", ["key", "updatedAt"]);

const publisherAbuseScoreRuns = defineTable({
  modelVersion: v.string(),
  modelConfig: publisherAbuseModelConfigValidator,
  trigger: v.union(v.literal("cron"), v.literal("manual")),
  actorUserId: v.optional(v.id("users")),
  status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
  phase: v.union(v.literal("collecting"), v.literal("finalizing"), v.literal("completed")),
  collectCursor: v.optional(v.string()),
  finalizeCursor: v.optional(v.string()),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  updatedAt: v.number(),
  scannedPublishers: v.number(),
  scoredPublishers: v.number(),
  finalizedScores: v.number(),
  nominatedPublishers: v.number(),
  passCount: v.number(),
  reviewCount: v.number(),
  potentialBanCandidateCount: v.number(),
  sumLogPressure: v.number(),
  sumSquaredLogPressure: v.number(),
  meanLogPressure: v.optional(v.number()),
  stdDevLogPressure: v.optional(v.number()),
  temporalMode: v.optional(v.union(v.literal("current"), v.literal("backfill"))),
  temporalScanComplete: v.optional(v.boolean()),
  temporalPipelinePhase: v.optional(
    v.union(
      v.literal("collecting"),
      v.literal("downloads_percentiles"),
      v.literal("spike_percentiles"),
      v.literal("classifying"),
      v.literal("completed"),
    ),
  ),
  temporalTodayDay: v.optional(v.number()),
  temporalSourceCursor: v.optional(v.string()),
  temporalDownloadsCursor: v.optional(v.string()),
  temporalSpikeCursor: v.optional(v.string()),
  temporalCandidateCursor: v.optional(v.string()),
  temporalSampleSize: v.optional(v.number()),
  temporalDownloadsSum: v.optional(v.number()),
  temporalDownloadsProcessed: v.optional(v.number()),
  temporalSpikeProcessed: v.optional(v.number()),
  temporalDownloadsMedian: v.optional(v.number()),
  temporalDownloadsP95: v.optional(v.number()),
  temporalDownloadsP99: v.optional(v.number()),
  temporalSpikeP95: v.optional(v.number()),
  temporalSpikeP99: v.optional(v.number()),
  temporalBenchmark: v.optional(
    v.object({
      scope: v.optional(v.literal("all_active_skills")),
      sampleSize: v.number(),
      downloads30dAverage: v.number(),
      downloads30dMedian: v.number(),
      downloads30dP95: v.number(),
      downloads30dP99: v.number(),
      spikeMultiplier7dP95: v.number(),
      spikeMultiplier7dP99: v.number(),
    }),
  ),
  errorMessage: v.optional(v.string()),
  transientErrorCount: v.optional(v.number()),
  lastTransientError: v.optional(v.string()),
  lastTransientErrorAt: v.optional(v.number()),
  nextTransientRetryAt: v.optional(v.number()),
})
  .index("by_status_and_updated_at", ["status", "updatedAt"])
  .index("by_model_version_and_started_at", ["modelVersion", "startedAt"])
  .index("by_model_version_and_status_and_updated_at", ["modelVersion", "status", "updatedAt"])
  .index("by_model_version_and_status_and_trigger_and_updated_at", [
    "modelVersion",
    "status",
    "trigger",
    "updatedAt",
  ])
  .index("by_model_status_phase_temporal_complete_started_at", [
    "modelVersion",
    "status",
    "phase",
    "temporalMode",
    "temporalScanComplete",
    "startedAt",
  ])
  .index("by_started_at", ["startedAt"]);

const publisherAbuseTemporalScanSamples = defineTable({
  runId: v.id("publisherAbuseScoreRuns"),
  recent30Downloads: v.number(),
  spikeMultiplier: v.number(),
  expirationTime: v.number(),
})
  .index("by_run_id_and_recent30_downloads", ["runId", "recent30Downloads"])
  .index("by_run_id_and_spike_multiplier", ["runId", "spikeMultiplier"])
  .index("by_expiration_time", ["expirationTime"]);

const publisherAbuseTemporalScanScoreValidator = v.object({
  spike: v.boolean(),
  sustained: v.boolean(),
  nearConversion: v.boolean(),
  pressure: v.number(),
  recent7Downloads: v.number(),
  recent7Installs: v.number(),
  previous30Downloads: v.number(),
  baseline7Downloads: v.number(),
  spikeMultiplier: v.number(),
  recent30Downloads: v.number(),
  recent30Installs: v.number(),
  downloadInstallRatio30: v.number(),
  downloads30dCohortBand: v.optional(v.union(v.literal("p95"), v.literal("p99"))),
  spikeMultiplierCohortBand: v.optional(v.union(v.literal("p95"), v.literal("p99"))),
  downloads30dVsPeerP95: v.optional(v.number()),
  spikeMultiplierVsPeerP95: v.optional(v.number()),
  installDownloadRatio7: v.number(),
  installDownloadRatio30: v.number(),
  installDownloadExcessZScore7: v.number(),
  installDownloadExcessZScore30: v.number(),
  spikeWindowStartDay: v.optional(v.number()),
  spikeWindowEndDay: v.optional(v.number()),
  sustainedWindowStartDay: v.optional(v.number()),
  sustainedWindowEndDay: v.optional(v.number()),
  nearConversionWindowStartDay: v.optional(v.number()),
  nearConversionWindowEndDay: v.optional(v.number()),
  reasonCodes: v.array(v.string()),
});

const publisherAbuseTemporalScanCandidates = defineTable({
  runId: v.id("publisherAbuseScoreRuns"),
  ownerKey: v.string(),
  ownerPublisherId: v.optional(v.id("publishers")),
  ownerUserId: v.optional(v.id("users")),
  handleSnapshot: v.string(),
  skillId: v.id("skills"),
  slug: v.string(),
  displayName: v.string(),
  totalDownloads: v.number(),
  totalInstalls: v.number(),
  temporalScore: publisherAbuseTemporalScanScoreValidator,
  expirationTime: v.number(),
})
  .index("by_run_id", ["runId"])
  .index("by_expiration_time", ["expirationTime"]);

const publisherAbuseScores = defineTable({
  runId: v.id("publisherAbuseScoreRuns"),
  ownerKey: v.string(),
  ownerPublisherId: v.optional(v.id("publishers")),
  ownerUserId: v.optional(v.id("users")),
  handleSnapshot: v.string(),
  modelVersion: v.string(),
  label: publisherAbuseDryRunLabelValidator,
  rank: v.number(),
  pressure: v.number(),
  logPressure: v.number(),
  zScore: v.number(),
  publishedSkills: v.number(),
  totalInstalls: v.number(),
  totalStars: v.number(),
  totalDownloads: v.number(),
  installsPerSkill: v.number(),
  starsPerSkill: v.number(),
  downloadsPerSkill: v.number(),
  reasonCodes: v.array(v.string()),
  temporalHighSkillCount: v.optional(v.number()),
  temporalP99SkillCount: v.optional(v.number()),
  temporalSpikeSkillCount: v.optional(v.number()),
  temporalSustainedSkillCount: v.optional(v.number()),
  temporalMaxPressure: v.optional(v.number()),
  temporalBenchmark: v.optional(
    v.object({
      scope: v.optional(v.literal("all_active_skills")),
      sampleSize: v.number(),
      downloads30dAverage: v.number(),
      downloads30dMedian: v.number(),
      downloads30dP95: v.number(),
      downloads30dP99: v.number(),
      spikeMultiplier7dP95: v.number(),
      spikeMultiplier7dP99: v.number(),
    }),
  ),
  temporalEvidence: v.optional(
    v.array(
      v.object({
        skillId: v.id("skills"),
        slug: v.string(),
        displayName: v.string(),
        spike: v.boolean(),
        sustained: v.boolean(),
        nearConversion: v.optional(v.boolean()),
        pressure: v.number(),
        recent7Downloads: v.number(),
        recent7Installs: v.number(),
        previous30Downloads: v.number(),
        baseline7Downloads: v.number(),
        spikeMultiplier: v.number(),
        recent30Downloads: v.number(),
        recent30Installs: v.number(),
        downloadInstallRatio30: v.number(),
        downloads30dCohortBand: v.optional(v.union(v.literal("p95"), v.literal("p99"))),
        spikeMultiplierCohortBand: v.optional(v.union(v.literal("p95"), v.literal("p99"))),
        downloads30dVsPeerP95: v.optional(v.number()),
        spikeMultiplierVsPeerP95: v.optional(v.number()),
        installDownloadRatio7: v.optional(v.number()),
        installDownloadRatio30: v.optional(v.number()),
        installDownloadExcessZScore7: v.optional(v.number()),
        installDownloadExcessZScore30: v.optional(v.number()),
        spikeWindowStartDay: v.optional(v.number()),
        spikeWindowEndDay: v.optional(v.number()),
        sustainedWindowStartDay: v.optional(v.number()),
        sustainedWindowEndDay: v.optional(v.number()),
        nearConversionWindowStartDay: v.optional(v.number()),
        nearConversionWindowEndDay: v.optional(v.number()),
        reasonCodes: v.array(v.string()),
      }),
    ),
  ),
  createdAt: v.number(),
})
  .index("by_run_and_rank", ["runId", "rank"])
  .index("by_run_and_label_and_rank", ["runId", "label", "rank"])
  .index("by_run_and_pressure", ["runId", "pressure"])
  .index("by_run_and_owner_key", ["runId", "ownerKey"])
  .index("by_owner_key_and_created_at", ["ownerKey", "createdAt"])
  .index("by_owner_key_and_model_version", ["ownerKey", "modelVersion"])
  .index("by_label_and_z_score", ["label", "zScore"]);

const publisherAbuseReviewNominations = defineTable({
  ownerKey: v.string(),
  ownerPublisherId: v.optional(v.id("publishers")),
  ownerUserId: v.optional(v.id("users")),
  handleSnapshot: v.string(),
  latestScoreId: v.id("publisherAbuseScores"),
  modelVersion: v.string(),
  label: publisherAbuseDryRunLabelValidator,
  status: publisherAbuseTriageStatusValidator,
  openedAt: v.number(),
  openedByRunId: v.id("publisherAbuseScoreRuns"),
  lastScoredAt: v.number(),
  reviewedByUserId: v.optional(v.id("users")),
  reviewedAt: v.optional(v.number()),
  notes: v.optional(v.string()),
  warningSentAt: v.optional(v.number()),
  warningExpiresAt: v.optional(v.number()),
  warningScoreId: v.optional(v.id("publisherAbuseScores")),
  warningRunId: v.optional(v.id("publisherAbuseScoreRuns")),
  warningPendingAt: v.optional(v.number()),
  warningPendingScoreId: v.optional(v.id("publisherAbuseScores")),
  warningPendingRunId: v.optional(v.id("publisherAbuseScoreRuns")),
  updatedAt: v.number(),
})
  .index("by_owner_key_and_model_version", ["ownerKey", "modelVersion"])
  .index("by_status_and_last_scored_at", ["status", "lastScoredAt"])
  .index("by_status_and_updated_at", ["status", "updatedAt"])
  .index("by_status_and_reviewed_at", ["status", "reviewedAt"])
  .index("by_status_and_label_and_last_scored_at", ["status", "label", "lastScoredAt"])
  .index("by_status_and_model_version_and_label_and_last_scored_at", [
    "status",
    "modelVersion",
    "label",
    "lastScoredAt",
  ])
  .index("by_label_and_status_and_last_scored_at", ["label", "status", "lastScoredAt"])
  .index("by_last_scored_at", ["lastScoredAt"]);

const publisherAbuseReviewEvents = defineTable({
  nominationId: v.id("publisherAbuseReviewNominations"),
  ownerKey: v.string(),
  actorUserId: v.optional(v.id("users")),
  runId: v.optional(v.id("publisherAbuseScoreRuns")),
  scoreId: v.optional(v.id("publisherAbuseScores")),
  eventType: v.union(
    v.literal("nomination_opened"),
    v.literal("nomination_score_updated"),
    v.literal("autoban_warning_sent"),
    v.literal("triage_status_changed"),
  ),
  previousStatus: v.optional(publisherAbuseTriageStatusValidator),
  nextStatus: v.optional(publisherAbuseTriageStatusValidator),
  previousLabel: v.optional(publisherAbuseDryRunLabelValidator),
  nextLabel: v.optional(publisherAbuseDryRunLabelValidator),
  notes: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_nomination_and_created_at", ["nominationId", "createdAt"])
  .index("by_owner_key_and_created_at", ["ownerKey", "createdAt"])
  .index("by_actor_and_created_at", ["actorUserId", "createdAt"]);

const publisherAbuseSignalTypeValidator = v.union(
  v.literal("high_install_download_ratio"),
  v.literal("sustained_downloads_flat_installs"),
);

const publisherAbuseSignalReviewStatusValidator = v.union(
  v.literal("open"),
  v.literal("snoozed"),
  v.literal("dismissed"),
);

const publisherAbuseSignals = defineTable({
  signalType: publisherAbuseSignalTypeValidator,
  ownerKey: v.string(),
  ownerPublisherId: v.union(v.id("publishers"), v.null()),
  ownerUserId: v.union(v.id("users"), v.null()),
  handleSnapshot: v.string(),
  skillId: v.id("skills"),
  skillSlug: v.string(),
  skillDisplayName: v.string(),
  latestRunId: v.optional(v.id("publisherAbuseScoreRuns")),
  latestScoreId: v.optional(v.id("publisherAbuseScores")),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  seenCount: v.number(),
  recent7Downloads: v.number(),
  recent7Installs: v.number(),
  recent7InstallDownloadRatio: v.number(),
  recent30Downloads: v.number(),
  recent30Installs: v.number(),
  recent30InstallDownloadRatio: v.number(),
  allTimeDownloads: v.number(),
  allTimeInstalls: v.number(),
  allTimeInstallDownloadRatio: v.number(),
  temporalBenchmark: v.optional(
    v.object({
      scope: v.optional(v.literal("all_active_skills")),
      sampleSize: v.number(),
      downloads30dAverage: v.number(),
      downloads30dMedian: v.number(),
      downloads30dP95: v.number(),
      downloads30dP99: v.number(),
      spikeMultiplier7dP95: v.number(),
      spikeMultiplier7dP99: v.number(),
    }),
  ),
  reviewStatus: publisherAbuseSignalReviewStatusValidator,
  snoozedUntil: v.optional(v.number()),
  reviewedByUserId: v.optional(v.id("users")),
  reviewedAt: v.optional(v.number()),
  reviewNote: v.optional(v.string()),
  lastChangedAt: v.optional(v.number()),
  needsNotification: v.optional(v.boolean()),
  notificationClaimedAt: v.optional(v.number()),
  lastNotifiedAt: v.optional(v.number()),
  lastNotificationError: v.optional(v.string()),
})
  .index("by_last_seen_at", ["lastSeenAt"])
  .index("by_signal_type_and_last_seen_at", ["signalType", "lastSeenAt"])
  .index("by_owner_key_and_last_seen_at", ["ownerKey", "lastSeenAt"])
  .index("by_skill_and_signal_type", ["skillId", "signalType"])
  .index("by_skill_signal_type_and_owner_key", ["skillId", "signalType", "ownerKey"])
  .index("by_review_status_and_last_seen_at", ["reviewStatus", "lastSeenAt"])
  .index("by_needs_notification_and_last_changed_at", ["needsNotification", "lastChangedAt"])
  .index("by_needs_notification_and_notification_claimed_at", [
    "needsNotification",
    "notificationClaimedAt",
  ]);

const publisherAbuseSignalReviewEventTypeValidator = v.union(
  v.literal("snoozed"),
  v.literal("dismissed"),
  v.literal("reopened"),
);

const publisherAbuseSignalReviewEvents = defineTable({
  signalId: v.id("publisherAbuseSignals"),
  ownerKey: v.string(),
  actorUserId: v.id("users"),
  eventType: publisherAbuseSignalReviewEventTypeValidator,
  previousStatus: publisherAbuseSignalReviewStatusValidator,
  nextStatus: publisherAbuseSignalReviewStatusValidator,
  note: v.optional(v.string()),
  snoozedUntil: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_signal_and_created_at", ["signalId", "createdAt"])
  .index("by_owner_key_and_created_at", ["ownerKey", "createdAt"])
  .index("by_actor_and_created_at", ["actorUserId", "createdAt"]);

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

const cliDeviceCodes = defineTable({
  deviceCodeHash: v.string(),
  userCodeHash: v.string(),
  userCode: v.string(),
  label: v.string(),
  scope: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("denied"),
    v.literal("consumed"),
    v.literal("expired"),
  ),
  approvedByUserId: v.optional(v.id("users")),
  createdAt: v.number(),
  expiresAt: v.number(),
  approvedAt: v.optional(v.number()),
  consumedAt: v.optional(v.number()),
  deniedAt: v.optional(v.number()),
})
  .index("by_device_code_hash", ["deviceCodeHash"])
  .index("by_user_code_hash", ["userCodeHash"])
  .index("by_status_expires", ["status", "expiresAt"]);

const httpRateLimitKeys = defineTable({
  name: v.string(),
  key: v.string(),
  shard: v.optional(v.number()),
  lastTouchedAt: v.number(),
  expiresAt: v.number(),
})
  .index("by_name_and_key_and_shard", ["name", "key", "shard"])
  .index("by_name_and_key_and_expires_at", ["name", "key", "expiresAt"])
  .index("by_expires_at", ["expiresAt"]);

const downloadMetricTargetKind = v.union(v.literal("skill"), v.literal("package"));
const downloadMetricIdentityKind = v.union(v.literal("user"), v.literal("ip"));

const downloadMetricDedupes = defineTable({
  targetKind: downloadMetricTargetKind,
  targetId: v.string(),
  identityKind: downloadMetricIdentityKind,
  identityHash: v.string(),
  dayStart: v.number(),
  createdAt: v.number(),
})
  .index("by_target_identity_day", [
    "targetKind",
    "targetId",
    "identityKind",
    "identityHash",
    "dayStart",
  ])
  .index("by_day", ["dayStart"]);

const packageInstallMetricDedupes = defineTable({
  targetKind: v.literal("package"),
  targetId: v.id("packages"),
  metricKind: v.literal("install"),
  identityKind: downloadMetricIdentityKind,
  identityHash: v.string(),
  dayStart: v.number(),
  createdAt: v.number(),
})
  .index("by_target_metric_identity_day", [
    "targetKind",
    "targetId",
    "metricKind",
    "identityKind",
    "identityHash",
    "dayStart",
  ])
  .index("by_day", ["dayStart"]);

const installTelemetryDedupes = defineTable({
  userId: v.id("users"),
  skillId: v.id("skills"),
  dayStart: v.number(),
  createdAt: v.number(),
})
  .index("by_user_skill_day", ["userId", "skillId", "dayStart"])
  .index("by_user", ["userId"])
  .index("by_user_createdAt", ["userId", "createdAt"])
  .index("by_skill", ["skillId"])
  .index("by_day", ["dayStart"]);

const reservedSlugs = defineTable({
  slug: v.string(),
  originalOwnerUserId: v.id("users"),
  originalOwnerPublisherId: v.optional(v.id("publishers")),
  deletedAt: v.number(),
  expiresAt: v.number(),
  reason: v.optional(v.string()),
  releasedAt: v.optional(v.number()),
})
  .index("by_slug", ["slug"])
  .index("by_slug_active_deletedAt", ["slug", "releasedAt", "deletedAt"])
  .index("by_owner", ["originalOwnerUserId"])
  .index("by_expiry", ["expiresAt"]);

const reservedHandles = defineTable({
  handle: v.string(),
  rightfulOwnerUserId: v.id("users"),
  reason: v.optional(v.string()),
  releasedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_handle", ["handle"])
  .index("by_handle_active_updatedAt", ["handle", "releasedAt", "updatedAt"])
  .index("by_owner", ["rightfulOwnerUserId"]);

const registryArtifactBackupSyncState = defineTable({
  key: v.string(),
  cursor: v.optional(v.string()),
  isDone: v.optional(v.boolean()),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

const registryArtifactBackupJobs = defineTable({
  targetKind: v.union(v.literal("skillVersion"), v.literal("packageRelease")),
  skillVersionId: v.optional(v.id("skillVersions")),
  packageReleaseId: v.optional(v.id("packageReleases")),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("exhausted"),
    v.literal("missingArtifact"),
  ),
  reason: v.union(v.literal("publish"), v.literal("seed"), v.literal("retry"), v.literal("sync")),
  attempts: v.number(),
  nextRunAt: v.number(),
  leaseToken: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  claimedAt: v.optional(v.number()),
  lastAttemptAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  exhaustedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_status_nextRunAt", ["status", "nextRunAt"])
  .index("by_status_leaseExpiresAt", ["status", "leaseExpiresAt"])
  .index("by_status_attempts", ["status", "attempts"])
  .index("by_skill_version", ["skillVersionId"])
  .index("by_package_release", ["packageReleaseId"])
  .index("by_updatedAt", ["updatedAt"]);

const userSkillInstalls = defineTable({
  userId: v.id("users"),
  skillId: v.id("skills"),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  lastVersion: v.optional(v.string()),
})
  .index("by_user", ["userId"])
  .index("by_user_lastSeenAt", ["userId", "lastSeenAt"])
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
  authSessions,
  authRefreshTokens,
  users,
  publishers,
  publisherMembers,
  publisherInvites,
  publisherImageUploadTickets,
  officialPublishers,
  githubSkillSources,
  githubSkillContents,
  githubSkillScans,
  skills,
  skillSlugAliases,
  packages,
  packageReleases,
  catalogClassificationResults,
  packageInspectorWarnings,
  packageInspectorFindingNotifications,
  packageInspectorScanCursors,
  securityScanJobs,
  securityScanDispatchState,
  skillScanRequests,
  skillScanRequestFileChunks,
  skillCardGenerationJobs,
  packageStatEvents,
  packageDailyStats,
  packageLeaderboards,
  packageTrustedPublishers,
  packagePublishTokens,
  packagePublishUploadTickets,
  packageBadges,
  packageSearchDigest,
  packageTopicSearchDigest,
  packagePluginCategorySearchDigest,
  skillVersions,
  publishAttempts,
  skillVersionFingerprints,
  skillBadges,
  skillEmbeddings,
  embeddingSkillMap,
  skillSearchDigest,
  curatedSkillSearchDigest,
  skillTopicSearchDigest,
  skillDailyStats,
  skillLeaderboards,
  skillStatBackfillState,
  globalStats,
  skillStatEvents,
  skillStatUpdateCursors,
  skillStatDocSyncLeases,
  skillReports,
  skillAppeals,
  skillModerationEventLogs,
  packageReports,
  packageAppeals,
  packageModerationEventLogs,
  officialPluginMigrations,
  catalogFeedPublications,
  publisherFeedPublications,
  stars,
  promotions,
  publisherFollows,
  auditLogs,
  systemSettings,
  publisherAbuseScoreRuns,
  publisherAbuseTemporalScanSamples,
  publisherAbuseTemporalScanCandidates,
  publisherAbuseScores,
  publisherAbuseReviewNominations,
  publisherAbuseReviewEvents,
  publisherAbuseSignals,
  publisherAbuseSignalReviewEvents,
  vtScanLogs,
  apiTokens,
  cliDeviceCodes,
  httpRateLimitKeys,
  downloadMetricDedupes,
  packageInstallMetricDedupes,
  installTelemetryDedupes,
  reservedSlugs,
  reservedHandles,
  registryArtifactBackupSyncState,
  registryArtifactBackupJobs,
  userSkillInstalls,
  skillOwnershipTransfers,
});
