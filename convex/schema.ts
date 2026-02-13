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
  githubCreatedAt: v.optional(v.number()),
  githubFetchedAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
})
  .index('email', ['email'])
  .index('phone', ['phone'])
  .index('handle', ['handle'])

const skills = defineTable({
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  resourceId: v.optional(v.string()),
  ownerUserId: v.id('users'),
  canonicalSkillId: v.optional(v.id('skills')),
  forkOf: v.optional(
    v.object({
      skillId: v.id('skills'),
      kind: v.union(v.literal('fork'), v.literal('duplicate')),
      version: v.optional(v.string()),
      at: v.number(),
    }),
  ),
  latestVersionId: v.optional(v.id('skillVersions')),
  tags: v.record(v.string(), v.id('skillVersions')),
  softDeletedAt: v.optional(v.number()),
  badges: v.optional(
    v.object({
      redactionApproved: v.optional(
        v.object({
          byUserId: v.id('users'),
          at: v.number(),
        }),
      ),
      highlighted: v.optional(
        v.object({
          byUserId: v.id('users'),
          at: v.number(),
        }),
      ),
      official: v.optional(
        v.object({
          byUserId: v.id('users'),
          at: v.number(),
        }),
      ),
      deprecated: v.optional(
        v.object({
          byUserId: v.id('users'),
          at: v.number(),
        }),
      ),
    }),
  ),
  moderationStatus: v.optional(
    v.union(v.literal('active'), v.literal('hidden'), v.literal('removed')),
  ),
  moderationNotes: v.optional(v.string()),
  moderationReason: v.optional(v.string()),
  moderationFlags: v.optional(v.array(v.string())),
  lastReviewedAt: v.optional(v.number()),
  hiddenAt: v.optional(v.number()),
  hiddenBy: v.optional(v.id('users')),
  reportCount: v.optional(v.number()),
  lastReportedAt: v.optional(v.number()),
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
  .index('by_updated', ['updatedAt'])
  .index('by_stats_downloads', ['statsDownloads', 'updatedAt'])
  .index('by_stats_stars', ['statsStars', 'updatedAt'])
  .index('by_stats_installs_current', ['statsInstallsCurrent', 'updatedAt'])
  .index('by_stats_installs_all_time', ['statsInstallsAllTime', 'updatedAt'])
  .index('by_batch', ['batch'])
  .index('by_active_updated', ['softDeletedAt', 'updatedAt'])
  .index('by_active_created', ['softDeletedAt', 'createdAt'])
  .index('by_active_name', ['softDeletedAt', 'displayName'])
  .index('by_active_stats_downloads', ['softDeletedAt', 'statsDownloads', 'updatedAt'])
  .index('by_active_stats_stars', ['softDeletedAt', 'statsStars', 'updatedAt'])
  .index('by_active_stats_installs_all_time', [
    'softDeletedAt',
    'statsInstallsAllTime',
    'updatedAt',
  ])
  .index('by_canonical', ['canonicalSkillId'])
  .index('by_fork_of', ['forkOf.skillId'])

const souls = defineTable({
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  ownerUserId: v.id('users'),
  latestVersionId: v.optional(v.id('soulVersions')),
  tags: v.record(v.string(), v.id('soulVersions')),
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
  .index('by_slug', ['slug'])
  .index('by_owner', ['ownerUserId'])
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
  .index('by_skill_createdAt', ['skillId', 'createdAt'])
  .index('by_user', ['userId'])
  .index('by_skill_user', ['skillId', 'userId'])

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
  skills,
  souls,
  skillVersions,
  soulVersions,
  skillVersionFingerprints,
  skillBadges,
  soulVersionFingerprints,
  skillEmbeddings,
  soulEmbeddings,
  skillDailyStats,
  skillLeaderboards,
  skillStatBackfillState,
  skillStatEvents,
  skillStatUpdateCursors,
  comments,
  skillReports,
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
