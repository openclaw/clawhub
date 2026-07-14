import type { TableNames } from "../_generated/dataModel";

export const RETENTION_STANDARD_BATCH_SIZE = 500;

type BaseRetentionPolicy = {
  reason: string;
};

type PermanentRetentionPolicy = BaseRetentionPolicy & {
  classification: "permanent";
};

type DerivedRetentionPolicy = BaseRetentionPolicy & {
  classification: "derived";
  rebuildSource: string;
};

type DeprecatedRetentionPolicy = BaseRetentionPolicy & {
  classification: "deprecated";
  replacementTable?: TableNames;
  removalIssue?: string;
};

type EphemeralRetentionPolicy = BaseRetentionPolicy & {
  classification: "ephemeral";
  standardBatchSize: typeof RETENTION_STANDARD_BATCH_SIZE;
  prune: string;
  expirationField?: "expiresAt" | "expirationTime" | "dayStart" | "processedAt" | "createdAt";
  expirationIndex?: string;
  retention: string;
};

export type RetentionPolicy =
  | PermanentRetentionPolicy
  | DerivedRetentionPolicy
  | DeprecatedRetentionPolicy
  | EphemeralRetentionPolicy;

const permanent = (reason: string): PermanentRetentionPolicy => ({
  classification: "permanent",
  reason,
});

const derived = (reason: string, rebuildSource: string): DerivedRetentionPolicy => ({
  classification: "derived",
  reason,
  rebuildSource,
});

const ephemeral = (
  reason: string,
  options: Omit<EphemeralRetentionPolicy, "classification" | "reason" | "standardBatchSize">,
): EphemeralRetentionPolicy => ({
  classification: "ephemeral",
  reason,
  standardBatchSize: RETENTION_STANDARD_BATCH_SIZE,
  ...options,
});

export const RETENTION_POLICIES = {
  users: permanent("Canonical user profiles and account state."),
  authSessions: ephemeral("Convex Auth sessions expire after their total session duration.", {
    expirationField: "expirationTime",
    expirationIndex: "by_expiration_time",
    prune: "retention.pruneExpiredAuthSessionsInternal",
    retention: "Convex Auth session total duration.",
  }),
  authAccounts: permanent("Provider account links for active users."),
  authRefreshTokens: ephemeral("Convex Auth refresh tokens expire after inactive duration.", {
    expirationField: "expirationTime",
    expirationIndex: "by_expiration_time",
    prune: "retention.pruneExpiredAuthRefreshTokensInternal",
    retention: "Convex Auth inactive session duration.",
  }),
  authVerificationCodes: ephemeral("One-time verification codes expire by timestamp.", {
    expirationField: "expirationTime",
    prune: "convex-auth internal validation",
    retention: "Provider code expiration.",
  }),
  authVerifiers: ephemeral("OAuth PKCE verifier rows are temporary sign-in state.", {
    prune: "convex-auth sign-in/session cleanup",
    retention: "OAuth verifier lifecycle.",
  }),
  authRateLimits: ephemeral("Convex Auth OTP/password rate-limit rows are operational state.", {
    prune: "convex-auth internal rate-limit lifecycle",
    retention: "Auth provider rate-limit window.",
  }),
  publishers: permanent("Canonical publisher profiles."),
  publisherMembers: permanent("Canonical publisher membership records."),
  publisherInvites: ephemeral("Organization member invitations expire if they are not accepted.", {
    expirationField: "expiresAt",
    expirationIndex: "by_expires_at",
    prune: "retention.pruneExpiredPublisherInvitesInternal",
    retention: "Organization invitation TTL.",
  }),
  publisherImageUploadTickets: ephemeral(
    "Organization logo upload tickets expire shortly after creation.",
    {
      expirationField: "expiresAt",
      prune: "usage-time validation plus pending retention cleanup",
      retention: "Organization logo upload ticket TTL.",
    },
  ),
  officialPublishers: permanent("Manual official publisher assignments."),
  githubSkillSources: permanent("Tracked GitHub source configuration."),
  githubSkillContents: derived("Cached GitHub source content snapshots.", "githubSkillSources"),
  githubSkillScans: derived("Cached GitHub source scan state.", "githubSkillSources"),
  skills: permanent("Canonical skill records."),
  skillSlugAliases: permanent("Historical slug routing aliases."),
  packages: permanent("Canonical package records."),
  packageReleases: permanent("Canonical package release records."),
  publishAttempts: ephemeral(
    "Private staged publish workflow state expires unless later retained by moderation policy.",
    {
      expirationField: "expiresAt",
      expirationIndex: "by_expires_at",
      prune: "future publishAttempts cleanup in CLAW-467 staged-publish follow-up",
      retention:
        "Pending/finalized attempt TTL; later secret and moderation slices refine blocked retention.",
    },
  ),
  catalogClassificationResults: derived(
    "Catalog classification output can be recomputed from package and skill metadata.",
    "skills/packages",
  ),
  packageInspectorWarnings: permanent("Package inspector findings are user-facing review history."),
  packageInspectorFindingNotifications: permanent(
    "Notification sent-log prevents duplicate emails.",
  ),
  packageInspectorScanCursors: permanent("Package inspector scan progress cursor."),
  securityScanJobs: permanent("Security scan job history and current processing state."),
  securityScanDispatchState: permanent("Security scan worker dispatch coordination state."),
  skillScanRequests: ephemeral(
    "Uploaded or GitHub scan requests expire and delete temporary blobs.",
    {
      expirationField: "expiresAt",
      expirationIndex: "by_expires_at",
      prune: "securityScan.pruneExpiredSkillScanRequestsInternal",
      retention: "Scan request TTL.",
    },
  ),
  skillScanRequestFileChunks: ephemeral("Temporary chunk rows owned by expiring scan requests.", {
    prune: "securityScan.pruneExpiredSkillScanRequestsInternal",
    retention: "Parent skillScanRequests TTL.",
  }),
  skillCardGenerationJobs: permanent("Card generation job history and retry state."),
  packageStatEvents: ephemeral("Package stat event log only needs to survive processing.", {
    expirationField: "processedAt",
    expirationIndex: "by_unprocessed",
    prune: "packages.pruneProcessedPackageStatEventsInternal",
    retention: "Processed and older than 7 days.",
  }),
  packageDailyStats: permanent("Daily aggregate package stats are product analytics."),
  packageLeaderboards: derived(
    "Package trending snapshots can be rebuilt from packageDailyStats.",
    "packageDailyStats",
  ),
  packageTrustedPublishers: permanent("Trusted publishing configuration."),
  packagePublishTokens: ephemeral("Package publish tokens expire and can be revoked.", {
    expirationField: "expiresAt",
    prune: "usage-time validation plus pending retention cleanup",
    retention: "Publish token expiry.",
  }),
  packagePublishUploadTickets: ephemeral("Upload tickets expire shortly after creation.", {
    expirationField: "expiresAt",
    prune: "usage-time validation plus pending retention cleanup",
    retention: "Upload ticket TTL.",
  }),
  packageBadges: permanent("Curated package badges."),
  packageSearchDigest: derived("Search projection of package state.", "packages"),
  packageTopicSearchDigest: derived("Topic search projection of package state.", "packages"),
  packagePluginCategorySearchDigest: derived(
    "Plugin category search projection of package state.",
    "packages",
  ),
  skillVersions: permanent("Canonical skill version records."),
  skillVersionFingerprints: derived("Fingerprint projection of skill versions.", "skillVersions"),
  skillBadges: permanent("Curated skill badges."),
  skillEmbeddings: derived("Search embedding projection of skill versions.", "skillVersions"),
  embeddingSkillMap: derived("Lookup map for embedding rows.", "skillEmbeddings"),
  skillSearchDigest: derived("Search projection of skill state.", "skills"),
  curatedSkillSearchDigest: derived("Curated search projection of skill state.", "skills"),
  skillTopicSearchDigest: derived("Topic search projection of skill state.", "skills"),
  skillDailyStats: permanent("Daily aggregate stats are product analytics."),
  skillLeaderboards: derived("Leaderboard snapshots can be rebuilt from stats.", "skillDailyStats"),
  skillStatBackfillState: permanent("Backfill cursor state."),
  globalStats: derived("Global stats aggregate can be recalculated.", "skills/packages"),
  skillStatEvents: ephemeral(
    "Skill stat event log is retained only after both consumers pass it.",
    {
      expirationField: "processedAt",
      expirationIndex: "by_unprocessed",
      prune: "skillStatEvents.pruneProcessedSkillStatEventsInternal",
      retention: "Processed and older than 7 days, capped by stat cursor.",
    },
  ),
  skillStatUpdateCursors: permanent("Stat processing cursor state."),
  skillStatDocSyncLeases: ephemeral("Short-lived stat sync leases.", {
    prune: "lease overwrite/expiry semantics",
    retention: "Lease duration.",
  }),
  skillReports: permanent("Moderation reports and audit history."),
  skillAppeals: permanent("Moderation appeals and audit history."),
  skillModerationEventLogs: permanent("Moderation event audit log."),
  packageReports: permanent("Package moderation reports and audit history."),
  packageAppeals: permanent("Package moderation appeals and audit history."),
  packageModerationEventLogs: permanent("Package moderation event audit log."),
  officialPluginMigrations: permanent("Official plugin migration state."),
  catalogFeedPublications: permanent("Current published hosted catalog feed snapshot."),
  stars: permanent("User star records."),
  promotions: permanent("Curated promotional offers; ended records stay for launch-page history."),
  auditLogs: permanent("Audit logs are durable compliance/security history."),
  systemSettings: permanent("Durable operator-controlled system settings."),
  publisherAbuseScoreRuns: permanent("Abuse scoring run history."),
  publisherAbuseTemporalScanSamples: ephemeral(
    "Exact temporal percentile samples are temporary scan working state.",
    {
      expirationField: "expirationTime",
      expirationIndex: "by_expiration_time",
      prune: "publisherAbuseTemporalScan.pruneExpiredTemporalScanRowsInternal",
      retention: "Seven days after the scan starts.",
    },
  ),
  publisherAbuseTemporalScanCandidates: ephemeral(
    "Temporal review candidates are temporary scan working state.",
    {
      expirationField: "expirationTime",
      expirationIndex: "by_expiration_time",
      prune: "publisherAbuseTemporalScan.pruneExpiredTemporalScanRowsInternal",
      retention: "Seven days after the scan starts.",
    },
  ),
  publisherAbuseScores: permanent("Abuse score history used for review decisions."),
  publisherAbuseReviewNominations: permanent("Abuse review workflow state."),
  publisherAbuseReviewEvents: permanent("Abuse review event history."),
  publisherAbuseSignals: permanent("Durable publisher abuse signal archive for staff review."),
  publisherAbuseSignalReviewEvents: permanent("Abuse signal review event history."),
  vtScanLogs: permanent("VirusTotal scan log history."),
  apiTokens: permanent("User API tokens until revoked."),
  cliDeviceCodes: ephemeral("CLI device codes expire quickly.", {
    expirationField: "expiresAt",
    expirationIndex: "by_status_expires",
    prune: "usage-time expiry plus pending retention cleanup",
    retention: "Device code TTL.",
  }),
  httpRateLimitKeys: ephemeral(
    "Component-backed HTTP rate-limit key metadata is operational cleanup state.",
    {
      expirationField: "expiresAt",
      expirationIndex: "by_expires_at",
      prune: "rateLimits.pruneHttpRateLimitKeysInternal",
      retention: "Idle component key window plus buffer before component reset.",
    },
  ),
  downloadMetricDedupes: ephemeral(
    "Download dedupe rows are only needed for recent metric windows.",
    {
      expirationField: "dayStart",
      expirationIndex: "by_day",
      prune: "downloadMetrics.pruneDownloadMetricDedupesInternal",
      retention: "14 days.",
    },
  ),
  packageInstallMetricDedupes: ephemeral(
    "Package install dedupe rows are only needed for recent metric windows.",
    {
      expirationField: "dayStart",
      expirationIndex: "by_day",
      prune: "downloadMetrics.pruneDownloadMetricDedupesInternal",
      retention: "14 days.",
    },
  ),
  installTelemetryDedupes: ephemeral(
    "Install telemetry dedupe rows are only needed for recent metric windows.",
    {
      expirationField: "dayStart",
      expirationIndex: "by_day",
      prune: "telemetry.pruneInstallTelemetryDedupesInternal",
      retention: "14 days.",
    },
  ),
  reservedSlugs: ephemeral("Deleted slug reservations release after the cooldown window.", {
    expirationField: "expiresAt",
    expirationIndex: "by_expiry",
    prune: "usage-time release plus pending retention cleanup",
    retention: "Slug reservation cooldown.",
  }),
  reservedHandles: permanent("Reserved handles are explicit policy records until released."),
  registryArtifactBackupSyncState: permanent("Legacy registry artifact backup cursor state."),
  registryArtifactBackupJobs: permanent("Legacy registry artifact backup job history."),
  userSkillInstalls: permanent("Current user install records."),
  skillOwnershipTransfers: ephemeral("Ownership transfer invitations expire.", {
    expirationField: "expiresAt",
    prune: "usage-time validation plus pending retention cleanup",
    retention: "Transfer invitation TTL.",
  }),
} satisfies Record<TableNames, RetentionPolicy>;

export function getRetentionPolicy(tableName: TableNames) {
  return RETENTION_POLICIES[tableName];
}
