import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { EMBEDDING_DIMENSIONS } from './lib/embeddings'

const authSchema = authTables as unknown as Record<string, ReturnType<typeof defineTable>>

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
  role: v.optional(v.union(v.literal('admin'), v.literal('moderator'), v.literal('user'))),
  deletedAt: v.optional(v.number()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
})
  .index('email', ['email'])
  .index('phone', ['phone'])
  .index('handle', ['handle'])

const resources = defineTable({
  type: v.union(v.literal('skill'), v.literal('soul'), v.literal('extension')),
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  ownerUserId: v.id('users'),
  ownerHandle: v.optional(v.string()),
  softDeletedAt: v.optional(v.number()),
  moderationStatus: v.optional(
    v.union(v.literal('active'), v.literal('hidden'), v.literal('removed')),
  ),
  moderationFlags: v.optional(v.array(v.string())),
  statsDownloads: v.optional(v.number()),
  statsStars: v.optional(v.number()),
  statsInstallsCurrent: v.optional(v.number()),
  statsInstallsAllTime: v.optional(v.number()),
  stats: v.object({
    downloads: v.number(),
    installsCurrent: v.optional(v.number()),
    installsAllTime: v.optional(v.number()),
    stars: v.number(),
    versions: v.number(),
    comments: v.number(),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_type_slug', ['type', 'slug'])
  .index('by_type_owner', ['type', 'ownerUserId'])
  .index('by_type_owner_updated', ['type', 'ownerUserId', 'updatedAt'])
  .index('by_type_updated', ['type', 'updatedAt'])
  .index('by_type_active_updated', ['type', 'softDeletedAt', 'updatedAt'])
  .index('by_type_stats_downloads', ['type', 'statsDownloads', 'updatedAt'])
  .index('by_type_stats_stars', ['type', 'statsStars', 'updatedAt'])
  .index('by_type_stats_installs_current', ['type', 'statsInstallsCurrent', 'updatedAt'])
  .index('by_type_stats_installs_all_time', ['type', 'statsInstallsAllTime', 'updatedAt'])
  .index('by_type_active_stats_downloads', ['type', 'softDeletedAt', 'statsDownloads', 'updatedAt'])
  .index('by_type_active_stats_stars', ['type', 'softDeletedAt', 'statsStars', 'updatedAt'])
  .index('by_type_active_stats_installs_current', [
    'type',
    'softDeletedAt',
    'statsInstallsCurrent',
    'updatedAt',
  ])
  .index('by_type_active_stats_installs_all_time', [
    'type',
    'softDeletedAt',
    'statsInstallsAllTime',
    'updatedAt',
  ])

const skills = defineTable({
  resourceId: v.optional(v.id('resources')),
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  ownerUserId: v.id('users'),
  forkOf: v.optional(
    v.object({
      skillId: v.id('skills'),
      kind: v.literal('fork'),
      version: v.optional(v.string()),
      at: v.number(),
    }),
  ),
  latestVersionId: v.optional(v.id('skillVersions')),
  tags: v.record(v.string(), v.id('skillVersions')),
  softDeletedAt: v.optional(v.number()),
  moderationStatus: v.optional(
    v.union(v.literal('active'), v.literal('hidden'), v.literal('removed')),
  ),
  moderationFlags: v.optional(v.array(v.string())),
  batch: v.optional(v.string()),
  statsDownloads: v.optional(v.number()),
  statsStars: v.optional(v.number()),
  statsInstallsCurrent: v.optional(v.number()),
  statsInstallsAllTime: v.optional(v.number()),
  stats: v.object({
    downloads: v.number(),
    installsCurrent: v.optional(v.number()),
    installsAllTime: v.optional(v.number()),
    stars: v.number(),
    versions: v.number(),
    comments: v.number(),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_slug', ['slug'])
  .index('by_owner', ['ownerUserId'])
  .index('by_resource', ['resourceId'])
  .index('by_updated', ['updatedAt'])
  .index('by_stats_downloads', ['statsDownloads', 'updatedAt'])
  .index('by_stats_stars', ['statsStars', 'updatedAt'])
  .index('by_stats_installs_current', ['statsInstallsCurrent', 'updatedAt'])
  .index('by_stats_installs_all_time', ['statsInstallsAllTime', 'updatedAt'])
  .index('by_batch', ['batch'])
  .index('by_active_updated', ['softDeletedAt', 'updatedAt'])

const souls = defineTable({
  resourceId: v.optional(v.id('resources')),
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  ownerUserId: v.id('users'),
  latestVersionId: v.optional(v.id('soulVersions')),
  tags: v.record(v.string(), v.id('soulVersions')),
  softDeletedAt: v.optional(v.number()),
  moderationStatus: v.optional(
    v.union(v.literal('active'), v.literal('hidden'), v.literal('removed')),
  ),
  moderationFlags: v.optional(v.array(v.string())),
  stats: v.object({
    downloads: v.number(),
    stars: v.number(),
    versions: v.number(),
    comments: v.number(),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_slug', ['slug'])
  .index('by_owner', ['ownerUserId'])
  .index('by_resource', ['resourceId'])
  .index('by_updated', ['updatedAt'])

const extensions = defineTable({
  resourceId: v.optional(v.id('resources')),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_resource', ['resourceId'])
  .index('by_updated', ['updatedAt'])

const skillVersions = defineTable({
  skillId: v.id('skills'),
  version: v.string(),
  fingerprint: v.optional(v.string()),
  changelog: v.string(),
  changelogSource: v.optional(v.union(v.literal('auto'), v.literal('user'))),
  files: v.array(
    v.object({
      path: v.string(),
      size: v.number(),
      storageId: v.id('_storage'),
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
  createdBy: v.id('users'),
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
})
  .index('by_skill', ['skillId'])
  .index('by_skill_version', ['skillId', 'version'])

const soulVersions = defineTable({
  soulId: v.id('souls'),
  version: v.string(),
  fingerprint: v.optional(v.string()),
  changelog: v.string(),
  changelogSource: v.optional(v.union(v.literal('auto'), v.literal('user'))),
  files: v.array(
    v.object({
      path: v.string(),
      size: v.number(),
      storageId: v.id('_storage'),
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
  createdBy: v.id('users'),
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
})
  .index('by_soul', ['soulId'])
  .index('by_soul_version', ['soulId', 'version'])

const skillVersionFingerprints = defineTable({
  skillId: v.id('skills'),
  versionId: v.id('skillVersions'),
  fingerprint: v.string(),
  createdAt: v.number(),
})
  .index('by_version', ['versionId'])
  .index('by_fingerprint', ['fingerprint'])
  .index('by_skill_fingerprint', ['skillId', 'fingerprint'])

const resourceBadges = defineTable({
  resourceId: v.id('resources'),
  kind: v.union(
    v.literal('highlighted'),
    v.literal('official'),
    v.literal('deprecated'),
    v.literal('redactionApproved'),
  ),
  byUserId: v.id('users'),
  at: v.number(),
})
  .index('by_resource', ['resourceId'])
  .index('by_resource_kind', ['resourceId', 'kind'])
  .index('by_kind_at', ['kind', 'at'])

const skillBadges = defineTable({
  skillId: v.id('skills'),
  kind: v.union(
    v.literal('highlighted'),
    v.literal('official'),
    v.literal('deprecated'),
    v.literal('redactionApproved'),
  ),
  byUserId: v.id('users'),
  at: v.number(),
})
  .index('by_skill', ['skillId'])
  .index('by_skill_kind', ['skillId', 'kind'])
  .index('by_kind_at', ['kind', 'at'])

const soulVersionFingerprints = defineTable({
  soulId: v.id('souls'),
  versionId: v.id('soulVersions'),
  fingerprint: v.string(),
  createdAt: v.number(),
})
  .index('by_version', ['versionId'])
  .index('by_fingerprint', ['fingerprint'])
  .index('by_soul_fingerprint', ['soulId', 'fingerprint'])

const skillEmbeddings = defineTable({
  skillId: v.id('skills'),
  versionId: v.id('skillVersions'),
  ownerId: v.id('users'),
  embedding: v.array(v.number()),
  isLatest: v.boolean(),
  isApproved: v.boolean(),
  visibility: v.string(),
  updatedAt: v.number(),
})
  .index('by_skill', ['skillId'])
  .index('by_version', ['versionId'])
  .vectorIndex('by_embedding', {
    vectorField: 'embedding',
    dimensions: EMBEDDING_DIMENSIONS,
    filterFields: ['visibility'],
  })

const skillDailyStats = defineTable({
  skillId: v.id('skills'),
  day: v.number(),
  downloads: v.number(),
  installs: v.number(),
  updatedAt: v.number(),
})
  .index('by_skill_day', ['skillId', 'day'])
  .index('by_day', ['day'])

const skillLeaderboards = defineTable({
  kind: v.string(),
  generatedAt: v.number(),
  rangeStartDay: v.number(),
  rangeEndDay: v.number(),
  items: v.array(
    v.object({
      skillId: v.id('skills'),
      score: v.number(),
      installs: v.number(),
      downloads: v.number(),
    }),
  ),
}).index('by_kind', ['kind', 'generatedAt'])

const skillStatBackfillState = defineTable({
  key: v.string(),
  cursor: v.optional(v.string()),
  doneAt: v.optional(v.number()),
  updatedAt: v.number(),
}).index('by_key', ['key'])

const skillStatEvents = defineTable({
  skillId: v.id('skills'),
  kind: v.union(
    v.literal('download'),
    v.literal('star'),
    v.literal('unstar'),
    v.literal('install_new'),
    v.literal('install_reactivate'),
    v.literal('install_deactivate'),
    v.literal('install_clear'),
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
  .index('by_unprocessed', ['processedAt'])
  .index('by_skill', ['skillId'])

const skillStatUpdateCursors = defineTable({
  key: v.string(),
  cursorCreationTime: v.optional(v.number()),
  updatedAt: v.number(),
}).index('by_key', ['key'])

const automodCursors = defineTable({
  key: v.string(),
  cursorUpdatedAt: v.optional(v.number()),
  updatedAt: v.number(),
}).index('by_key', ['key'])

const maintenance = defineTable({
  key: v.string(),
  enabled: v.boolean(),
  message: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_key', ['key'])

const soulEmbeddings = defineTable({
  soulId: v.id('souls'),
  versionId: v.id('soulVersions'),
  ownerId: v.id('users'),
  embedding: v.array(v.number()),
  isLatest: v.boolean(),
  isApproved: v.boolean(),
  visibility: v.string(),
  updatedAt: v.number(),
})
  .index('by_soul', ['soulId'])
  .index('by_version', ['versionId'])
  .vectorIndex('by_embedding', {
    vectorField: 'embedding',
    dimensions: EMBEDDING_DIMENSIONS,
    filterFields: ['visibility'],
  })

const comments = defineTable({
  skillId: v.id('skills'),
  userId: v.id('users'),
  body: v.string(),
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id('users')),
})
  .index('by_skill', ['skillId'])
  .index('by_user', ['userId'])

const skillReports = defineTable({
  skillId: v.id('skills'),
  userId: v.id('users'),
  reason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_skill', ['skillId'])
  .index('by_user', ['userId'])
  .index('by_skill_user', ['skillId', 'userId'])

const skillReportStats = defineTable({
  skillId: v.id('skills'),
  reportCount: v.number(),
  lastReportedAt: v.optional(v.number()),
})
  .index('by_skill', ['skillId'])
  .index('by_last_reported', ['lastReportedAt'])

const skillModeration = defineTable({
  skillId: v.id('skills'),
  notes: v.optional(v.string()),
  reason: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  hiddenAt: v.optional(v.number()),
  hiddenBy: v.optional(v.id('users')),
})
  .index('by_skill', ['skillId'])
  .index('by_reviewed', ['reviewedAt'])

const soulComments = defineTable({
  soulId: v.id('souls'),
  userId: v.id('users'),
  body: v.string(),
  createdAt: v.number(),
  softDeletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id('users')),
})
  .index('by_soul', ['soulId'])
  .index('by_user', ['userId'])

const stars = defineTable({
  skillId: v.id('skills'),
  userId: v.id('users'),
  createdAt: v.number(),
})
  .index('by_skill', ['skillId'])
  .index('by_user', ['userId'])
  .index('by_skill_user', ['skillId', 'userId'])

const soulStars = defineTable({
  soulId: v.id('souls'),
  userId: v.id('users'),
  createdAt: v.number(),
})
  .index('by_soul', ['soulId'])
  .index('by_user', ['userId'])
  .index('by_soul_user', ['soulId', 'userId'])

const auditLogs = defineTable({
  actorUserId: v.id('users'),
  action: v.string(),
  targetType: v.string(),
  targetId: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index('by_actor', ['actorUserId'])
  .index('by_target', ['targetType', 'targetId'])

const apiTokens = defineTable({
  userId: v.id('users'),
  label: v.string(),
  prefix: v.string(),
  tokenHash: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index('by_user', ['userId'])
  .index('by_hash', ['tokenHash'])

const rateLimits = defineTable({
  key: v.string(),
  windowStart: v.number(),
  count: v.number(),
  limit: v.number(),
  updatedAt: v.number(),
})
  .index('by_key_window', ['key', 'windowStart'])
  .index('by_key', ['key'])

const githubBackupSyncState = defineTable({
  key: v.string(),
  cursor: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_key', ['key'])

const userSyncRoots = defineTable({
  userId: v.id('users'),
  rootId: v.string(),
  label: v.string(),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  expiredAt: v.optional(v.number()),
})
  .index('by_user', ['userId'])
  .index('by_user_root', ['userId', 'rootId'])

const userSkillInstalls = defineTable({
  userId: v.id('users'),
  skillId: v.id('skills'),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  activeRoots: v.number(),
  lastVersion: v.optional(v.string()),
})
  .index('by_user', ['userId'])
  .index('by_user_skill', ['userId', 'skillId'])
  .index('by_skill', ['skillId'])

const userSkillRootInstalls = defineTable({
  userId: v.id('users'),
  rootId: v.string(),
  skillId: v.id('skills'),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  lastVersion: v.optional(v.string()),
  removedAt: v.optional(v.number()),
})
  .index('by_user', ['userId'])
  .index('by_user_root', ['userId', 'rootId'])
  .index('by_user_root_skill', ['userId', 'rootId', 'skillId'])
  .index('by_user_skill', ['userId', 'skillId'])
  .index('by_skill', ['skillId'])

export default defineSchema({
  ...authSchema,
  users,
  resources,
  skills,
  souls,
  extensions,
  skillVersions,
  soulVersions,
  skillVersionFingerprints,
  resourceBadges,
  skillBadges,
  soulVersionFingerprints,
  skillEmbeddings,
  soulEmbeddings,
  skillDailyStats,
  skillLeaderboards,
  skillStatBackfillState,
  skillStatEvents,
  skillStatUpdateCursors,
  automodCursors,
  maintenance,
  comments,
  skillReports,
  skillReportStats,
  skillModeration,
  soulComments,
  stars,
  soulStars,
  auditLogs,
  apiTokens,
  rateLimits,
  githubBackupSyncState,
  userSyncRoots,
  userSkillInstalls,
  userSkillRootInstalls,
})
