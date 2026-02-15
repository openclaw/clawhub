import { getAuthUserId } from '@convex-dev/auth/server'
import { paginationOptsValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { assertAdmin, assertModerator, requireUser, requireUserFromAction } from './lib/access'
import {
  getSkillBadgeMap,
  getSkillBadgeMaps,
  isSkillHighlighted,
  type SkillBadgeMap,
} from './lib/badges'
import { generateChangelogPreview as buildChangelogPreview } from './lib/changelog'
import {
  canHealSkillOwnershipByGitHubProviderAccountId,
  getGitHubProviderAccountId,
} from './lib/githubIdentity'
import { buildTrendingLeaderboard } from './lib/leaderboards'
import { deriveModerationFlags } from './lib/moderation'
import { toPublicSkill, toPublicUser } from './lib/public'
import { embeddingVisibilityFor } from './lib/embeddingVisibility'
import {
  enforceReservedSlugCooldownForNewSkill,
  getLatestActiveReservedSlug,
  reserveSlugForHardDeleteFinalize,
  upsertReservedSlugForRightfulOwner,
} from './lib/reservedSlugs'
import {
  fetchText,
  type PublishResult,
  publishVersionForUser,
  queueHighlightedWebhook,
} from './lib/skillPublish'
import { isSkillSuspicious } from './lib/skillSafety'
import { getFrontmatterValue, hashSkillFiles } from './lib/skills'

export { publishVersionForUser } from './lib/skillPublish'

type ReadmeResult = { path: string; text: string }
type FileTextResult = { path: string; text: string; size: number; sha256: string }

const MAX_DIFF_FILE_BYTES = 200 * 1024
const MAX_LIST_LIMIT = 50
const MAX_PUBLIC_LIST_LIMIT = 200
const MAX_LIST_BULK_LIMIT = 200
const MAX_LIST_TAKE = 1000
const MAX_BADGE_LOOKUP_SKILLS = 200
const HARD_DELETE_BATCH_SIZE = 100
const HARD_DELETE_VERSION_BATCH_SIZE = 10
const HARD_DELETE_LEADERBOARD_BATCH_SIZE = 25
const MAX_ACTIVE_REPORTS_PER_USER = 20
const AUTO_HIDE_REPORT_THRESHOLD = 3
const MAX_REPORT_REASON_SAMPLE = 5
const RATE_LIMIT_HOUR_MS = 60 * 60 * 1000
const RATE_LIMIT_DAY_MS = 24 * RATE_LIMIT_HOUR_MS
const SLUG_RESERVATION_DAYS = 90
const SLUG_RESERVATION_MS = SLUG_RESERVATION_DAYS * RATE_LIMIT_DAY_MS
const LOW_TRUST_ACCOUNT_AGE_MS = 30 * RATE_LIMIT_DAY_MS
const TRUSTED_PUBLISHER_SKILL_THRESHOLD = 10
const LOW_TRUST_BURST_THRESHOLD_PER_HOUR = 8
const OWNER_ACTIVITY_SCAN_LIMIT = 500
const NEW_SKILL_RATE_LIMITS = {
  lowTrust: { perHour: 5, perDay: 20 },
  trusted: { perHour: 20, perDay: 80 },
} as const

const SORT_INDEXES = {
  newest: 'by_active_created',
  updated: 'by_active_updated',
  name: 'by_active_name',
  downloads: 'by_active_stats_downloads',
  stars: 'by_active_stats_stars',
  installs: 'by_active_stats_installs_all_time',
} as const

function isSkillVersionId(
  value: Id<'skillVersions'> | null | undefined,
): value is Id<'skillVersions'> {
  return typeof value === 'string' && value.startsWith('skillVersions:')
}

function isUserId(value: Id<'users'> | null | undefined): value is Id<'users'> {
  return typeof value === 'string' && value.startsWith('users:')
}

type OwnerTrustSignals = {
  isLowTrust: boolean
  skillsLastHour: number
  skillsLastDay: number
}

function isPrivilegedOwnerForSuspiciousBypass(owner: Doc<'users'> | null | undefined) {
  if (!owner) return false
  return owner.role === 'admin' || owner.role === 'moderator'
}

function stripSuspiciousFlag(flags: string[] | undefined) {
  if (!flags?.length) return undefined
  const next = flags.filter((flag) => flag !== 'flagged.suspicious')
  return next.length ? next : undefined
}

function normalizeScannerSuspiciousReason(reason: string | undefined) {
  if (!reason) return reason
  if (!reason.startsWith('scanner.') || !reason.endsWith('.suspicious')) return reason
  return `${reason.slice(0, -'.suspicious'.length)}.clean`
}

async function getOwnerTrustSignals(
  ctx: QueryCtx | MutationCtx,
  owner: Doc<'users'>,
  now: number,
): Promise<OwnerTrustSignals> {
  const ownerSkills = await ctx.db
    .query('skills')
    .withIndex('by_owner', (q) => q.eq('ownerUserId', owner._id))
    .order('desc')
    .take(OWNER_ACTIVITY_SCAN_LIMIT)

  const hourThreshold = now - RATE_LIMIT_HOUR_MS
  const dayThreshold = now - RATE_LIMIT_DAY_MS
  let skillsLastHour = 0
  let skillsLastDay = 0

  for (const skill of ownerSkills) {
    if (skill.createdAt >= dayThreshold) {
      skillsLastDay += 1
      if (skill.createdAt >= hourThreshold) {
        skillsLastHour += 1
      }
    }
  }

  const accountCreatedAt = owner.createdAt ?? owner._creationTime
  const accountAgeMs = Math.max(0, now - accountCreatedAt)
  const isLowTrust =
    accountAgeMs < LOW_TRUST_ACCOUNT_AGE_MS ||
    ownerSkills.length < TRUSTED_PUBLISHER_SKILL_THRESHOLD ||
    skillsLastHour >= LOW_TRUST_BURST_THRESHOLD_PER_HOUR

  return { isLowTrust, skillsLastHour, skillsLastDay }
}

function enforceNewSkillRateLimit(signals: OwnerTrustSignals) {
  const limits = signals.isLowTrust ? NEW_SKILL_RATE_LIMITS.lowTrust : NEW_SKILL_RATE_LIMITS.trusted
  if (signals.skillsLastHour >= limits.perHour) {
    throw new ConvexError(
      `Rate limit: max ${limits.perHour} new skills per hour. Please wait before publishing more.`,
    )
  }
  if (signals.skillsLastDay >= limits.perDay) {
    throw new ConvexError(
      `Rate limit: max ${limits.perDay} new skills per 24 hours. Please wait before publishing more.`,
    )
  }
}

async function resolveOwnerHandle(ctx: QueryCtx, ownerUserId: Id<'users'>) {
  const owner = await ctx.db.get(ownerUserId)
  if (!owner || owner.deletedAt || owner.deactivatedAt) return null
  return owner?.handle ?? owner?._id ?? null
}

const HARD_DELETE_PHASES = [
  'versions',
  'fingerprints',
  'embeddings',
  'comments',
  'reports',
  'stars',
  'badges',
  'dailyStats',
  'statEvents',
  'installs',
  'rootInstalls',
  'leaderboards',
  'canonical',
  'forks',
  'finalize',
] as const

type HardDeletePhase = (typeof HARD_DELETE_PHASES)[number]

function isHardDeletePhase(value: string | undefined): value is HardDeletePhase {
  if (!value) return false
  return (HARD_DELETE_PHASES as readonly string[]).includes(value)
}

async function scheduleHardDelete(
  ctx: MutationCtx,
  skillId: Id<'skills'>,
  actorUserId: Id<'users'>,
  phase: HardDeletePhase,
) {
  await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
    skillId,
    actorUserId,
    phase,
  })
}

async function hardDeleteSkillStep(
  ctx: MutationCtx,
  skill: Doc<'skills'>,
  actorUserId: Id<'users'>,
  phase: HardDeletePhase,
) {
  const now = Date.now()
  const patch: Partial<Doc<'skills'>> = {}
  if (!skill.softDeletedAt) patch.softDeletedAt = now
  if (skill.moderationStatus !== 'removed') patch.moderationStatus = 'removed'
  if (!skill.hiddenAt) patch.hiddenAt = now
  if (!skill.hiddenBy) patch.hiddenBy = actorUserId
  if (Object.keys(patch).length) {
    patch.lastReviewedAt = now
    patch.updatedAt = now
    await ctx.db.patch(skill._id, patch)
  }

  switch (phase) {
    case 'versions': {
      const versions = await ctx.db
        .query('skillVersions')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_VERSION_BATCH_SIZE)
      for (const version of versions) {
        await ctx.db.delete(version._id)
      }
      if (versions.length === HARD_DELETE_VERSION_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'versions')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'fingerprints')
      return
    }
    case 'fingerprints': {
      const fingerprints = await ctx.db
        .query('skillVersionFingerprints')
        .withIndex('by_skill_fingerprint', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const fingerprint of fingerprints) {
        await ctx.db.delete(fingerprint._id)
      }
      if (fingerprints.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'fingerprints')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'embeddings')
      return
    }
    case 'embeddings': {
      const embeddings = await ctx.db
        .query('skillEmbeddings')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const embedding of embeddings) {
        await ctx.db.delete(embedding._id)
      }
      if (embeddings.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'embeddings')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'comments')
      return
    }
    case 'comments': {
      const comments = await ctx.db
        .query('comments')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const comment of comments) {
        await ctx.db.delete(comment._id)
      }
      if (comments.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'comments')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'reports')
      return
    }
    case 'reports': {
      const reports = await ctx.db
        .query('skillReports')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const report of reports) {
        await ctx.db.delete(report._id)
      }
      if (reports.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'reports')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'stars')
      return
    }
    case 'stars': {
      const stars = await ctx.db
        .query('stars')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const star of stars) {
        await ctx.db.delete(star._id)
      }
      if (stars.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'stars')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'badges')
      return
    }
    case 'badges': {
      const badges = await ctx.db
        .query('skillBadges')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const badge of badges) {
        await ctx.db.delete(badge._id)
      }
      if (badges.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'badges')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'dailyStats')
      return
    }
    case 'dailyStats': {
      const dailyStats = await ctx.db
        .query('skillDailyStats')
        .withIndex('by_skill_day', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const stat of dailyStats) {
        await ctx.db.delete(stat._id)
      }
      if (dailyStats.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'dailyStats')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'statEvents')
      return
    }
    case 'statEvents': {
      const statEvents = await ctx.db
        .query('skillStatEvents')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const statEvent of statEvents) {
        await ctx.db.delete(statEvent._id)
      }
      if (statEvents.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'statEvents')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'installs')
      return
    }
    case 'installs': {
      const installs = await ctx.db
        .query('userSkillInstalls')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const install of installs) {
        await ctx.db.delete(install._id)
      }
      if (installs.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'installs')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'rootInstalls')
      return
    }
    case 'rootInstalls': {
      const rootInstalls = await ctx.db
        .query('userSkillRootInstalls')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const rootInstall of rootInstalls) {
        await ctx.db.delete(rootInstall._id)
      }
      if (rootInstalls.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'rootInstalls')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'leaderboards')
      return
    }
    case 'leaderboards': {
      const leaderboards = await ctx.db
        .query('skillLeaderboards')
        .take(HARD_DELETE_LEADERBOARD_BATCH_SIZE)
      for (const leaderboard of leaderboards) {
        const items = leaderboard.items.filter((item) => item.skillId !== skill._id)
        if (items.length !== leaderboard.items.length) {
          await ctx.db.patch(leaderboard._id, { items })
        }
      }
      if (leaderboards.length === HARD_DELETE_LEADERBOARD_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'leaderboards')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'canonical')
      return
    }
    case 'canonical': {
      const canonicalRefs = await ctx.db
        .query('skills')
        .withIndex('by_canonical', (q) => q.eq('canonicalSkillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const related of canonicalRefs) {
        await ctx.db.patch(related._id, {
          canonicalSkillId: undefined,
          updatedAt: now,
        })
      }
      if (canonicalRefs.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'canonical')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'forks')
      return
    }
    case 'forks': {
      const forkRefs = await ctx.db
        .query('skills')
        .withIndex('by_fork_of', (q) => q.eq('forkOf.skillId', skill._id))
        .take(HARD_DELETE_BATCH_SIZE)
      for (const related of forkRefs) {
        await ctx.db.patch(related._id, {
          forkOf: undefined,
          updatedAt: now,
        })
      }
      if (forkRefs.length === HARD_DELETE_BATCH_SIZE) {
        await scheduleHardDelete(ctx, skill._id, actorUserId, 'forks')
        return
      }
      await scheduleHardDelete(ctx, skill._id, actorUserId, 'finalize')
      return
    }
    case 'finalize': {
      await reserveSlugForHardDeleteFinalize(ctx, {
        slug: skill.slug,
        originalOwnerUserId: skill.ownerUserId,
        deletedAt: now,
        expiresAt: now + SLUG_RESERVATION_MS,
      })

      await ctx.db.delete(skill._id)
      await ctx.db.insert('auditLogs', {
        actorUserId,
        action: 'skill.hard_delete',
        targetType: 'skill',
        targetId: skill._id,
        metadata: { slug: skill.slug },
        createdAt: now,
      })
      return
    }
  }
}

type PublicSkillEntry = {
  skill: NonNullable<ReturnType<typeof toPublicSkill>>
  latestVersion: PublicSkillListVersion | null
  ownerHandle: string | null
}

type PublicSkillListVersion = Pick<
  Doc<'skillVersions'>,
  '_id' | '_creationTime' | 'version' | 'createdAt' | 'changelog' | 'changelogSource'
> & {
  parsed?: {
    clawdis?: {
      nix?: {
        plugin?: boolean
      }
    }
  }
}

type ManagementSkillEntry = {
  skill: Doc<'skills'>
  latestVersion: Doc<'skillVersions'> | null
  owner: Doc<'users'> | null
}

type BadgeKind = Doc<'skillBadges'>['kind']

async function buildPublicSkillEntries(ctx: QueryCtx, skills: Doc<'skills'>[]) {
  const ownerHandleCache = new Map<Id<'users'>, Promise<string | null>>()
  const badgeMapBySkillId: Map<Id<'skills'>, SkillBadgeMap> = skills.length <=
  MAX_BADGE_LOOKUP_SKILLS
    ? await getSkillBadgeMaps(
        ctx,
        skills.map((skill) => skill._id),
      )
    : new Map()

  const getOwnerHandle = (ownerUserId: Id<'users'>) => {
    const cached = ownerHandleCache.get(ownerUserId)
    if (cached) return cached
    const handlePromise = resolveOwnerHandle(ctx, ownerUserId)
    ownerHandleCache.set(ownerUserId, handlePromise)
    return handlePromise
  }

  const entries = await Promise.all(
    skills.map(async (skill) => {
      const [latestVersionDoc, ownerHandle] = await Promise.all([
        skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : null,
        getOwnerHandle(skill.ownerUserId),
      ])
      const badges = badgeMapBySkillId.get(skill._id) ?? {}
      const publicSkill = toPublicSkill({ ...skill, badges })
      if (!publicSkill) return null
      const latestVersion = toPublicSkillListVersion(latestVersionDoc)
      return { skill: publicSkill, latestVersion, ownerHandle }
    }),
  )

  return entries.filter((entry): entry is PublicSkillEntry => entry !== null)
}

function toPublicSkillListVersion(
  version: Doc<'skillVersions'> | null,
): PublicSkillListVersion | null {
  if (!version) return null
  return {
    _id: version._id,
    _creationTime: version._creationTime,
    version: version.version,
    createdAt: version.createdAt,
    changelog: version.changelog,
    changelogSource: version.changelogSource,
    parsed: version.parsed?.clawdis ? { clawdis: version.parsed.clawdis } : undefined,
  }
}

async function buildManagementSkillEntries(ctx: QueryCtx, skills: Doc<'skills'>[]) {
  const ownerCache = new Map<Id<'users'>, Promise<Doc<'users'> | null>>()
  const badgeMapBySkillId = await getSkillBadgeMaps(
    ctx,
    skills.map((skill) => skill._id),
  )

  const getOwner = (ownerUserId: Id<'users'>) => {
    const cached = ownerCache.get(ownerUserId)
    if (cached) return cached
    const ownerPromise = ctx.db.get(ownerUserId)
    ownerCache.set(ownerUserId, ownerPromise)
    return ownerPromise
  }

  return Promise.all(
    skills.map(async (skill) => {
      const [latestVersion, owner] = await Promise.all([
        skill.latestVersionId ? ctx.db.get(skill.latestVersionId) : null,
        getOwner(skill.ownerUserId),
      ])
      const badges = badgeMapBySkillId.get(skill._id) ?? {}
      return { skill: { ...skill, badges }, latestVersion, owner }
    }),
  ) satisfies Promise<ManagementSkillEntry[]>
}

async function attachBadgesToSkills(ctx: QueryCtx, skills: Doc<'skills'>[]) {
  const badgeMapBySkillId = await getSkillBadgeMaps(
    ctx,
    skills.map((skill) => skill._id),
  )
  return skills.map((skill) => ({
    ...skill,
    badges: badgeMapBySkillId.get(skill._id) ?? {},
  }))
}

async function loadHighlightedSkills(ctx: QueryCtx, limit: number) {
  const entries = await ctx.db
    .query('skillBadges')
    .withIndex('by_kind_at', (q) => q.eq('kind', 'highlighted'))
    .order('desc')
    .take(MAX_LIST_TAKE)

  const skills: Doc<'skills'>[] = []
  for (const badge of entries) {
    const skill = await ctx.db.get(badge.skillId)
    if (!skill || skill.softDeletedAt) continue
    skills.push(skill)
    if (skills.length >= limit) break
  }

  return skills
}

async function upsertSkillBadge(
  ctx: MutationCtx,
  skillId: Id<'skills'>,
  kind: BadgeKind,
  userId: Id<'users'>,
  at: number,
) {
  const existing = await ctx.db
    .query('skillBadges')
    .withIndex('by_skill_kind', (q) => q.eq('skillId', skillId).eq('kind', kind))
    .unique()
  if (existing) {
    await ctx.db.patch(existing._id, { byUserId: userId, at })
    return existing._id
  }
  return ctx.db.insert('skillBadges', {
    skillId,
    kind,
    byUserId: userId,
    at,
  })
}

async function removeSkillBadge(ctx: MutationCtx, skillId: Id<'skills'>, kind: BadgeKind) {
  const existing = await ctx.db
    .query('skillBadges')
    .withIndex('by_skill_kind', (q) => q.eq('skillId', skillId).eq('kind', kind))
    .unique()
  if (existing) {
    await ctx.db.delete(existing._id)
  }
}

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()
    if (!skill || skill.softDeletedAt) return null

    const userId = await getAuthUserId(ctx)
    const isOwner = Boolean(userId && userId === skill.ownerUserId)

    const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null
    const owner = await ctx.db.get(skill.ownerUserId)
    const badges = await getSkillBadgeMap(ctx, skill._id)

    const forkOfSkill = skill.forkOf?.skillId ? await ctx.db.get(skill.forkOf.skillId) : null
    const forkOfOwner = forkOfSkill ? await ctx.db.get(forkOfSkill.ownerUserId) : null

    const canonicalSkill = skill.canonicalSkillId ? await ctx.db.get(skill.canonicalSkillId) : null
    const canonicalOwner = canonicalSkill ? await ctx.db.get(canonicalSkill.ownerUserId) : null

    const publicSkill = toPublicSkill({ ...skill, badges })

    // Determine moderation state
    const isPendingScan =
      skill.moderationStatus === 'hidden' && skill.moderationReason === 'pending.scan'
    const isMalwareBlocked = skill.moderationFlags?.includes('blocked.malware') ?? false
    const isSuspicious = skill.moderationFlags?.includes('flagged.suspicious') ?? false
    const isHiddenByMod = skill.moderationStatus === 'hidden' && !isPendingScan && !isMalwareBlocked
    const isRemoved = skill.moderationStatus === 'removed'

    // Non-owners can see malware-blocked skills (transparency), but not other hidden states
    // Owners can see all their moderated skills
    if (!publicSkill && !isOwner && !isMalwareBlocked) return null

    // For owners viewing their moderated skill, construct the response manually
    const skillData = publicSkill ?? {
      _id: skill._id,
      _creationTime: skill._creationTime,
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary,
      ownerUserId: skill.ownerUserId,
      canonicalSkillId: skill.canonicalSkillId,
      forkOf: skill.forkOf,
      latestVersionId: skill.latestVersionId,
      tags: skill.tags,
      badges,
      stats: skill.stats,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    }

    // Moderation info - visible to owners for all states, or anyone for flagged skills (transparency)
    const showModerationInfo = isOwner || isMalwareBlocked || isSuspicious
    const moderationInfo = showModerationInfo
      ? {
          isPendingScan,
          isMalwareBlocked,
          isSuspicious,
          isHiddenByMod,
          isRemoved,
          reason: isOwner ? skill.moderationReason : undefined,
        }
      : null

    return {
      skill: skillData,
      latestVersion,
      owner,
      pendingReview: isOwner && isPendingScan,
      moderationInfo,
      forkOf: forkOfSkill
        ? {
            kind: skill.forkOf?.kind ?? 'fork',
            version: skill.forkOf?.version ?? null,
            skill: {
              slug: forkOfSkill.slug,
              displayName: forkOfSkill.displayName,
            },
            owner: {
              handle: forkOfOwner?.handle ?? forkOfOwner?.name ?? null,
              userId: forkOfOwner?._id ?? null,
            },
          }
        : null,
      canonical: canonicalSkill
        ? {
            skill: {
              slug: canonicalSkill.slug,
              displayName: canonicalSkill.displayName,
            },
            owner: {
              handle: canonicalOwner?.handle ?? canonicalOwner?.name ?? null,
              userId: canonicalOwner?._id ?? null,
            },
          }
        : null,
    }
  },
})

export const getBySlugForStaff = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)

    const skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()
    if (!skill) return null

    const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null
    const owner = toPublicUser(await ctx.db.get(skill.ownerUserId))
    const badges = await getSkillBadgeMap(ctx, skill._id)

    const forkOfSkill = skill.forkOf?.skillId ? await ctx.db.get(skill.forkOf.skillId) : null
    const forkOfOwner = forkOfSkill ? await ctx.db.get(forkOfSkill.ownerUserId) : null

    const canonicalSkill = skill.canonicalSkillId ? await ctx.db.get(skill.canonicalSkillId) : null
    const canonicalOwner = canonicalSkill ? await ctx.db.get(canonicalSkill.ownerUserId) : null

    return {
      skill: { ...skill, badges },
      latestVersion,
      owner,
      forkOf: forkOfSkill
        ? {
            kind: skill.forkOf?.kind ?? 'fork',
            version: skill.forkOf?.version ?? null,
            skill: {
              slug: forkOfSkill.slug,
              displayName: forkOfSkill.displayName,
            },
            owner: {
              handle: forkOfOwner?.handle ?? forkOfOwner?.name ?? null,
              userId: forkOfOwner?._id ?? null,
            },
          }
        : null,
      canonical: canonicalSkill
        ? {
            skill: {
              slug: canonicalSkill.slug,
              displayName: canonicalSkill.displayName,
            },
            owner: {
              handle: canonicalOwner?.handle ?? canonicalOwner?.name ?? null,
              userId: canonicalOwner?._id ?? null,
            },
          }
        : null,
    }
  },
})

export const getReservedSlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return getLatestActiveReservedSlug(ctx, args.slug)
  },
})

export const getSkillBySlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()
  },
})

export const getOwnerSkillActivityInternal = internalQuery({
  args: {
    ownerUserId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 60, 1, 500)
    const skills = await ctx.db
      .query('skills')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', args.ownerUserId))
      .order('desc')
      .take(limit)

    return skills.map((skill) => ({
      slug: skill.slug,
      summary: skill.summary,
      createdAt: skill.createdAt,
      latestVersionId: skill.latestVersionId,
    }))
  },
})

export const clearOwnerSuspiciousFlagsInternal = internalMutation({
  args: {
    ownerUserId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.ownerUserId)
    if (!owner || owner.deletedAt || owner.deactivatedAt) throw new Error('Owner not found')
    if (!isPrivilegedOwnerForSuspiciousBypass(owner)) {
      return { inspected: 0, updated: 0, skipped: 'owner_not_privileged' as const }
    }

    const limit = clampInt(args.limit ?? 500, 1, 5000)
    const skills = await ctx.db
      .query('skills')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', args.ownerUserId))
      .order('desc')
      .take(limit)

    let updated = 0
    const now = Date.now()

    for (const skill of skills) {
      const existingFlags: string[] = (skill.moderationFlags as string[] | undefined) ?? []
      const hasSuspiciousFlag = existingFlags.includes('flagged.suspicious')
      const hasSuspiciousReason =
        skill.moderationReason?.startsWith('scanner.') &&
        skill.moderationReason.endsWith('.suspicious')
      if (!hasSuspiciousFlag && !hasSuspiciousReason) continue

      const patch: Partial<Doc<'skills'>> = { updatedAt: now }
      patch.moderationFlags = stripSuspiciousFlag(existingFlags)
      if (hasSuspiciousReason) {
        patch.moderationReason = normalizeScannerSuspiciousReason(skill.moderationReason)
      }
      if (
        (skill.moderationStatus ?? 'active') === 'hidden' &&
        hasSuspiciousReason &&
        !skill.softDeletedAt
      ) {
        patch.moderationStatus = 'active'
      }

      await ctx.db.patch(skill._id, patch)
      updated += 1
    }

    return { inspected: skills.length, updated }
  },
})

/**
 * Get quick stats without loading versions (fast).
 */
export const getQuickStatsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allSkills = await ctx.db.query('skills').collect()
    const active = allSkills.filter((s) => !s.softDeletedAt)

    const byStatus: Record<string, number> = {}
    const byReason: Record<string, number> = {}

    for (const skill of active) {
      const status = skill.moderationStatus ?? 'active'
      byStatus[status] = (byStatus[status] ?? 0) + 1

      if (skill.moderationReason) {
        byReason[skill.moderationReason] = (byReason[skill.moderationReason] ?? 0) + 1
      }
    }

    return { total: active.length, byStatus, byReason }
  },
})

/**
 * Get aggregate stats for all skills (for social posts, dashboards, etc.)
 */
/**
 * Paginated helper: counts stats for a batch of skills.
 * Returns partial counts + cursor for the next page.
 */
export const getStatsPageInternal = internalQuery({
  args: { cursor: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const PAGE_SIZE = 500
    const cursor = args.cursor ?? 0

    const page = await ctx.db
      .query('skills')
      .filter((q) => q.gt(q.field('_creationTime'), cursor))
      .order('asc')
      .take(PAGE_SIZE)

    let total = 0
    const byStatus: Record<string, number> = {}
    const byReason: Record<string, number> = {}
    const byFlags: Record<string, number> = {}
    const vtStats = { clean: 0, suspicious: 0, malicious: 0, pending: 0, noAnalysis: 0 }

    for (const skill of page) {
      if (skill.softDeletedAt) continue
      total++

      const status = skill.moderationStatus ?? 'active'
      byStatus[status] = (byStatus[status] ?? 0) + 1

      if (skill.moderationReason) {
        byReason[skill.moderationReason] = (byReason[skill.moderationReason] ?? 0) + 1
      }

      for (const flag of skill.moderationFlags ?? []) {
        byFlags[flag] = (byFlags[flag] ?? 0) + 1
      }

      if (status === 'active') {
        const reason = skill.moderationReason
        if (!reason) {
          vtStats.noAnalysis++
        } else if (reason === 'scanner.vt.clean') {
          vtStats.clean++
        } else if (reason === 'scanner.vt.malicious') {
          vtStats.malicious++
        } else if (reason === 'scanner.vt.suspicious') {
          vtStats.suspicious++
        } else if (reason === 'scanner.vt.pending' || reason === 'pending.scan') {
          vtStats.pending++
        } else if (reason.startsWith('scanner.vt-rescan.')) {
          const suffix = reason.slice('scanner.vt-rescan.'.length)
          if (suffix === 'clean') vtStats.clean++
          else if (suffix === 'malicious') vtStats.malicious++
          else if (suffix === 'suspicious') vtStats.suspicious++
          else vtStats.pending++
        } else {
          vtStats.noAnalysis++
        }
      }
    }

    const nextCursor = page.length > 0 ? page[page.length - 1]._creationTime : null
    const done = page.length < PAGE_SIZE

    return { total, byStatus, byReason, byFlags, vtStats, nextCursor, done }
  },
})

export const getHighlightedCountInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const badges = await ctx.db
      .query('skillBadges')
      .withIndex('by_kind_at', (q) => q.eq('kind', 'highlighted'))
      .collect()
    return badges.length
  },
})

/**
 * Get aggregate stats for all skills (for social posts, dashboards, etc.)
 * Uses an action to call paginated queries, avoiding the 16MB byte limit.
 */
type StatsResult = {
  total: number
  highlighted: number
  byStatus: Record<string, number>
  byReason: Record<string, number>
  byFlags: Record<string, number>
  vtStats: {
    clean: number
    suspicious: number
    malicious: number
    pending: number
    noAnalysis: number
  }
}

export const getStatsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<StatsResult> => {
    let total = 0
    const byStatus: Record<string, number> = {}
    const byReason: Record<string, number> = {}
    const byFlags: Record<string, number> = {}
    const vtStats = { clean: 0, suspicious: 0, malicious: 0, pending: 0, noAnalysis: 0 }

    let cursor: number | undefined
    let done = false

    while (!done) {
      const page: {
        total: number
        byStatus: Record<string, number>
        byReason: Record<string, number>
        byFlags: Record<string, number>
        vtStats: {
          clean: number
          suspicious: number
          malicious: number
          pending: number
          noAnalysis: number
        }
        nextCursor: number | null
        done: boolean
      } = await ctx.runQuery(internal.skills.getStatsPageInternal, { cursor })

      total += page.total
      for (const [k, cnt] of Object.entries(page.byStatus)) {
        byStatus[k] = (byStatus[k] ?? 0) + cnt
      }
      for (const [k, cnt] of Object.entries(page.byReason)) {
        byReason[k] = (byReason[k] ?? 0) + cnt
      }
      for (const [k, cnt] of Object.entries(page.byFlags)) {
        byFlags[k] = (byFlags[k] ?? 0) + cnt
      }
      vtStats.clean += page.vtStats.clean
      vtStats.suspicious += page.vtStats.suspicious
      vtStats.malicious += page.vtStats.malicious
      vtStats.pending += page.vtStats.pending
      vtStats.noAnalysis += page.vtStats.noAnalysis

      done = page.done
      if (page.nextCursor !== null) {
        cursor = page.nextCursor
      }
    }

    const highlighted: number = await ctx.runQuery(internal.skills.getHighlightedCountInternal, {})

    return { total, highlighted, byStatus, byReason, byFlags, vtStats }
  },
})

export const list = query({
  args: {
    batch: v.optional(v.string()),
    ownerUserId: v.optional(v.id('users')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 24, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    if (args.batch) {
      if (args.batch === 'highlighted') {
        const skills = await loadHighlightedSkills(ctx, limit)
        const withBadges = await attachBadgesToSkills(ctx, skills)
        return withBadges
          .map((skill) => toPublicSkill(skill))
          .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
      }
      const entries = await ctx.db
        .query('skills')
        .withIndex('by_batch', (q) => q.eq('batch', args.batch))
        .order('desc')
        .take(takeLimit)
      const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
      const withBadges = await attachBadgesToSkills(ctx, filtered)
      return withBadges
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
    }
    const ownerUserId = args.ownerUserId
    if (ownerUserId) {
      const userId = await getAuthUserId(ctx)
      const isOwnDashboard = Boolean(userId && userId === ownerUserId)
      const entries = await ctx.db
        .query('skills')
        .withIndex('by_owner', (q) => q.eq('ownerUserId', ownerUserId))
        .order('desc')
        .take(takeLimit)
      const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
      const withBadges = await attachBadgesToSkills(ctx, filtered)

      if (isOwnDashboard) {
        // For owner's own dashboard, include pending skills
        return withBadges
          .map((skill) => {
            const publicSkill = toPublicSkill(skill)
            if (publicSkill) return publicSkill
            // Include pending skills for owner
            const isPending =
              skill.moderationStatus === 'hidden' && skill.moderationReason === 'pending.scan'
            if (isPending) {
              // Use computed badges from attachBadgesToSkills, not stored skill.badges
              const { badges } = skill
              return {
                _id: skill._id,
                _creationTime: skill._creationTime,
                slug: skill.slug,
                displayName: skill.displayName,
                summary: skill.summary,
                ownerUserId: skill.ownerUserId,
                canonicalSkillId: skill.canonicalSkillId,
                forkOf: skill.forkOf,
                latestVersionId: skill.latestVersionId,
                tags: skill.tags,
                badges,
                stats: skill.stats,
                createdAt: skill.createdAt,
                updatedAt: skill.updatedAt,
                pendingReview: true as const,
              }
            }
            return null
          })
          .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
      }

      return withBadges
        .map((skill) => toPublicSkill(skill))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
    }
    const entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    const filtered = entries.filter((skill) => !skill.softDeletedAt).slice(0, limit)
    const withBadges = await attachBadgesToSkills(ctx, filtered)
    return withBadges
      .map((skill) => toPublicSkill(skill))
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
  },
})

export const listWithLatest = query({
  args: {
    batch: v.optional(v.string()),
    ownerUserId: v.optional(v.id('users')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 24, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    let entries: Doc<'skills'>[] = []
    if (args.batch) {
      if (args.batch === 'highlighted') {
        entries = await loadHighlightedSkills(ctx, limit)
      } else {
        entries = await ctx.db
          .query('skills')
          .withIndex('by_batch', (q) => q.eq('batch', args.batch))
          .order('desc')
          .take(takeLimit)
      }
    } else if (args.ownerUserId) {
      const ownerUserId = args.ownerUserId
      entries = await ctx.db
        .query('skills')
        .withIndex('by_owner', (q) => q.eq('ownerUserId', ownerUserId))
        .order('desc')
        .take(takeLimit)
    } else {
      entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    }

    const filtered = entries.filter((skill) => !skill.softDeletedAt)
    const withBadges = await attachBadgesToSkills(ctx, filtered)
    const ordered =
      args.batch === 'highlighted'
        ? [...withBadges].sort(
            (a, b) => (b.badges?.highlighted?.at ?? 0) - (a.badges?.highlighted?.at ?? 0),
          )
        : withBadges
    const limited = ordered.slice(0, limit)
    const items = await Promise.all(
      limited.map(async (skill) => ({
        skill: toPublicSkill(skill),
        latestVersion: skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null,
      })),
    )
    return items.filter(
      (
        item,
      ): item is {
        skill: NonNullable<ReturnType<typeof toPublicSkill>>
        latestVersion: Doc<'skillVersions'> | null
      } => Boolean(item.skill),
    )
  },
})

export const listForManagement = query({
  args: {
    limit: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 50, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    const entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    const filtered = (
      args.includeDeleted ? entries : entries.filter((skill) => !skill.softDeletedAt)
    ).slice(0, limit)
    return buildManagementSkillEntries(ctx, filtered)
  },
})

export const listRecentVersions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_BULK_LIMIT)
    const versions = await ctx.db
      .query('skillVersions')
      .order('desc')
      .take(limit * 2)
    const entries = versions.filter((version) => !version.softDeletedAt).slice(0, limit)

    const results: Array<{
      version: Doc<'skillVersions'>
      skill: Doc<'skills'> | null
      owner: Doc<'users'> | null
    }> = []

    for (const version of entries) {
      const skill = await ctx.db.get(version.skillId)
      if (!skill) {
        results.push({ version, skill: null, owner: null })
        continue
      }
      const owner = await ctx.db.get(skill.ownerUserId)
      results.push({ version, skill, owner })
    }

    return results
  },
})

export const listReportedSkills = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 25, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    const entries = await ctx.db.query('skills').order('desc').take(takeLimit)
    const reported = entries
      .filter((skill) => (skill.reportCount ?? 0) > 0)
      .sort((a, b) => (b.lastReportedAt ?? 0) - (a.lastReportedAt ?? 0))
      .slice(0, limit)
    const managementEntries = await buildManagementSkillEntries(ctx, reported)
    const reporterCache = new Map<Id<'users'>, Promise<Doc<'users'> | null>>()

    const getReporter = (reporterId: Id<'users'>) => {
      const cached = reporterCache.get(reporterId)
      if (cached) return cached
      const reporterPromise = ctx.db.get(reporterId)
      reporterCache.set(reporterId, reporterPromise)
      return reporterPromise
    }

    return Promise.all(
      managementEntries.map(async (entry) => {
        const reports = await ctx.db
          .query('skillReports')
          .withIndex('by_skill_createdAt', (q) => q.eq('skillId', entry.skill._id))
          .order('desc')
          .take(MAX_REPORT_REASON_SAMPLE)
        const reportEntries = await Promise.all(
          reports.map(async (report) => {
            const reporter = await getReporter(report.userId)
            const reason = report.reason?.trim()
            return {
              reason: reason && reason.length > 0 ? reason : 'No reason provided.',
              createdAt: report.createdAt,
              reporterHandle: reporter?.handle ?? reporter?.name ?? null,
              reporterId: report.userId,
            }
          }),
        )
        return { ...entry, reports: reportEntries }
      }),
    )
  },
})

export const listDuplicateCandidates = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_BULK_LIMIT)
    const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
    const skills = await ctx.db.query('skills').order('desc').take(takeLimit)
    const entries = skills.filter((skill) => !skill.softDeletedAt).slice(0, limit)

    const results: Array<{
      skill: Doc<'skills'>
      latestVersion: Doc<'skillVersions'> | null
      fingerprint: string | null
      matches: Array<{ skill: Doc<'skills'>; owner: Doc<'users'> | null }>
      owner: Doc<'users'> | null
    }> = []

    for (const skill of entries) {
      const latestVersion = isSkillVersionId(skill.latestVersionId)
        ? await ctx.db.get(skill.latestVersionId)
        : null
      const fingerprint = latestVersion?.fingerprint ?? null
      if (!fingerprint) continue

      let matchedFingerprints: Doc<'skillVersionFingerprints'>[] = []
      try {
        matchedFingerprints = await ctx.db
          .query('skillVersionFingerprints')
          .withIndex('by_fingerprint', (q) => q.eq('fingerprint', fingerprint))
          .take(10)
      } catch (error) {
        console.error('listDuplicateCandidates: fingerprint lookup failed', error)
        continue
      }

      const matchEntries: Array<{ skill: Doc<'skills'>; owner: Doc<'users'> | null }> = []
      for (const match of matchedFingerprints) {
        if (match.skillId === skill._id) continue
        const matchSkill = await ctx.db.get(match.skillId)
        if (!matchSkill || matchSkill.softDeletedAt) continue
        const matchOwner = await ctx.db.get(matchSkill.ownerUserId)
        matchEntries.push({ skill: matchSkill, owner: matchOwner })
      }

      if (matchEntries.length === 0) continue

      const owner = isUserId(skill.ownerUserId) ? await ctx.db.get(skill.ownerUserId) : null
      results.push({
        skill,
        latestVersion,
        fingerprint,
        matches: matchEntries,
        owner,
      })
    }

    return results
  },
})

async function countActiveReportsForUser(ctx: MutationCtx, userId: Id<'users'>) {
  const reports = await ctx.db
    .query('skillReports')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()

  let count = 0
  for (const report of reports) {
    const skill = await ctx.db.get(report.skillId)
    if (!skill) continue
    if (skill.softDeletedAt) continue
    if (skill.moderationStatus === 'removed') continue
    const owner = await ctx.db.get(skill.ownerUserId)
    if (!owner || owner.deletedAt || owner.deactivatedAt) continue
    count += 1
    if (count >= MAX_ACTIVE_REPORTS_PER_USER) break
  }

  return count
}

export const report = mutation({
  args: { skillId: v.id('skills'), reason: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx)
    const skill = await ctx.db.get(args.skillId)
    if (!skill || skill.softDeletedAt || skill.moderationStatus === 'removed') {
      throw new Error('Skill not found')
    }
    const reason = args.reason.trim()
    if (!reason) {
      throw new Error('Report reason required.')
    }

    const existing = await ctx.db
      .query('skillReports')
      .withIndex('by_skill_user', (q) => q.eq('skillId', args.skillId).eq('userId', userId))
      .unique()
    if (existing) return { ok: true as const, reported: false, alreadyReported: true }

    const activeReports = await countActiveReportsForUser(ctx, userId)
    if (activeReports >= MAX_ACTIVE_REPORTS_PER_USER) {
      throw new Error('Report limit reached. Please wait for moderation before reporting more.')
    }

    const now = Date.now()
    await ctx.db.insert('skillReports', {
      skillId: args.skillId,
      userId,
      reason: reason.slice(0, 500),
      createdAt: now,
    })

    const nextReportCount = (skill.reportCount ?? 0) + 1
    const shouldAutoHide = nextReportCount > AUTO_HIDE_REPORT_THRESHOLD && !skill.softDeletedAt
    const updates: Partial<Doc<'skills'>> = {
      reportCount: nextReportCount,
      lastReportedAt: now,
      updatedAt: now,
    }
    if (shouldAutoHide) {
      Object.assign(updates, {
        softDeletedAt: now,
        moderationStatus: 'hidden',
        moderationReason: 'auto.reports',
        moderationNotes: 'Auto-hidden after 4 unique reports.',
        hiddenAt: now,
        lastReviewedAt: now,
      })
    }

    await ctx.db.patch(skill._id, updates)

    if (shouldAutoHide) {
      const embeddings = await ctx.db
        .query('skillEmbeddings')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .collect()
      for (const embedding of embeddings) {
        await ctx.db.patch(embedding._id, {
          visibility: 'deleted',
          updatedAt: now,
        })
      }

      await ctx.db.insert('auditLogs', {
        actorUserId: userId,
        action: 'skill.auto_hide',
        targetType: 'skill',
        targetId: skill._id,
        metadata: { reportCount: nextReportCount },
        createdAt: now,
      })
    }

    return { ok: true as const, reported: true, alreadyReported: false }
  },
})

// TODO: Delete listPublicPage once all clients have migrated to listPublicPageV2
export const listPublicPage = query({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    sort: v.optional(
      v.union(
        v.literal('updated'),
        v.literal('downloads'),
        v.literal('stars'),
        v.literal('installsCurrent'),
        v.literal('installsAllTime'),
        v.literal('trending'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? 'updated'
    const limit = clampInt(args.limit ?? 24, 1, MAX_PUBLIC_LIST_LIMIT)

    if (sort === 'updated') {
      const { page, isDone, continueCursor } = await ctx.db
        .query('skills')
        .withIndex('by_updated', (q) => q)
        .order('desc')
        .paginate({ cursor: args.cursor ?? null, numItems: limit })

      const skills = page.filter((skill) => !skill.softDeletedAt)
      const items = await buildPublicSkillEntries(ctx, skills)

      return { items, nextCursor: isDone ? null : continueCursor }
    }

    if (sort === 'trending') {
      const entries = await getTrendingEntries(ctx, limit)
      const skills: Doc<'skills'>[] = []

      for (const entry of entries) {
        const skill = await ctx.db.get(entry.skillId)
        if (!skill || skill.softDeletedAt) continue
        skills.push(skill)
        if (skills.length >= limit) break
      }

      const items = await buildPublicSkillEntries(ctx, skills)
      return { items, nextCursor: null }
    }

    const index = sortToIndex(sort)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .withIndex(index, (q) => q)
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: limit })

    const filtered = page.filter((skill) => !skill.softDeletedAt)
    const items = await buildPublicSkillEntries(ctx, filtered)
    return { items, nextCursor: isDone ? null : continueCursor }
  },
})

/**
 * V2 of listPublicPage using standard Convex pagination (paginate + usePaginatedQuery).
 *
 * Key differences from V1:
 * - Uses `by_active_updated` index to filter soft-deleted skills at query level
 * - Returns standard pagination shape compatible with usePaginatedQuery
 */
export const listPublicPageV2 = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.optional(
      v.union(
        v.literal('newest'),
        v.literal('updated'),
        v.literal('downloads'),
        v.literal('installs'),
        v.literal('stars'),
        v.literal('name'),
      ),
    ),
    dir: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
    nonSuspiciousOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? 'newest'
    const dir = args.dir ?? (sort === 'name' ? 'asc' : 'desc')
    const paginationOpts: { cursor: string | null; numItems: number; id?: number } = {
      ...args.paginationOpts,
      numItems: clampInt(args.paginationOpts.numItems, 1, MAX_PUBLIC_LIST_LIMIT),
    }

    // Use the index to filter out soft-deleted skills at query time.
    // softDeletedAt === undefined means active (non-deleted) skills only.
    const result = await ctx.db
      .query('skills')
      .withIndex(SORT_INDEXES[sort], (q) => q.eq('softDeletedAt', undefined))
      .order(dir)
      .paginate(paginationOpts)

    const filteredPage = args.nonSuspiciousOnly
      ? result.page.filter((skill) => !isSkillSuspicious(skill))
      : result.page

    // Build the public skill entries (fetch latestVersion + ownerHandle)
    const items = await buildPublicSkillEntries(ctx, filteredPage)
    return { ...result, page: items }
  },
})

function sortToIndex(
  sort: 'downloads' | 'stars' | 'installsCurrent' | 'installsAllTime',
):
  | 'by_stats_downloads'
  | 'by_stats_stars'
  | 'by_stats_installs_current'
  | 'by_stats_installs_all_time' {
  switch (sort) {
    case 'downloads':
      return 'by_stats_downloads'
    case 'stars':
      return 'by_stats_stars'
    case 'installsCurrent':
      return 'by_stats_installs_current'
    case 'installsAllTime':
      return 'by_stats_installs_all_time'
  }
}

async function getTrendingEntries(ctx: QueryCtx, limit: number) {
  // Use the pre-computed leaderboard from the hourly cron job.
  // Avoid Date.now() here to keep the query deterministic and cacheable.
  const latest = await ctx.db
    .query('skillLeaderboards')
    .withIndex('by_kind', (q) => q.eq('kind', 'trending'))
    .order('desc')
    .take(1)

  if (latest[0]) {
    return latest[0].items.slice(0, limit)
  }

  // No leaderboard exists yet (cold start) - compute on the fly
  const fallback = await buildTrendingLeaderboard(ctx, { limit, now: Date.now() })
  return fallback.items
}

export const listVersions = query({
  args: { skillId: v.id('skills'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20
    return ctx.db
      .query('skillVersions')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .order('desc')
      .take(limit)
  },
})

export const listVersionsPage = query({
  args: {
    skillId: v.id('skills'),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 20, 1, MAX_LIST_LIMIT)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skillVersions')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: limit })
    const items = page.filter((version) => !version.softDeletedAt)
    return { items, nextCursor: isDone ? null : continueCursor }
  },
})

export const getVersionById = query({
  args: { versionId: v.id('skillVersions') },
  handler: async (ctx, args) => ctx.db.get(args.versionId),
})

export const getVersionsByIdsInternal = internalQuery({
  args: { versionIds: v.array(v.id('skillVersions')) },
  handler: async (ctx, args) => {
    const versions = await Promise.all(args.versionIds.map((id) => ctx.db.get(id)))
    return versions.filter((v): v is NonNullable<typeof v> => v !== null)
  },
})

export const getVersionByIdInternal = internalQuery({
  args: { versionId: v.id('skillVersions') },
  handler: async (ctx, args) => ctx.db.get(args.versionId),
})

export const getSkillByIdInternal = internalQuery({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => ctx.db.get(args.skillId),
})

export const getPendingScanSkillsInternal = internalQuery({
  args: { limit: v.optional(v.number()), skipRecentMinutes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 10, 1, 100)
    const skipRecentMinutes = args.skipRecentMinutes ?? 60
    const skipThreshold = Date.now() - skipRecentMinutes * 60 * 1000

    // Use an indexed query and bounded scan to avoid full-table reads under spam/high volume.
    const poolSize = Math.min(Math.max(limit * 20, 200), 1000)
    const allSkills = await ctx.db
      .query('skills')
      .withIndex('by_active_updated', (q) => q.eq('softDeletedAt', undefined))
      .order('desc')
      .take(poolSize)

    const candidates = allSkills.filter((skill) => {
      const reason = skill.moderationReason
      if (skill.moderationStatus === 'hidden' && reason === 'pending.scan') return true
      if (skill.moderationStatus === 'hidden' && reason === 'quality.low') return true
      if (skill.moderationStatus === 'active' && reason === 'pending.scan') return true
      if (skill.moderationStatus === 'active' && reason === 'scanner.vt.pending') return true
      return (
        reason === 'scanner.llm.clean' ||
        reason === 'scanner.llm.suspicious' ||
        reason === 'scanner.llm.malicious'
      )
    })

    // Filter out recently checked skills
    const skills = candidates.filter(
      (s) => !s.scanLastCheckedAt || s.scanLastCheckedAt < skipThreshold,
    )

    // Shuffle and take the requested limit (Fisher-Yates)
    for (let i = skills.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[skills[i], skills[j]] = [skills[j], skills[i]]
    }
    const selected = skills.slice(0, limit)

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'> | null
      sha256hash: string | null
      checkCount: number
    }> = []

    for (const skill of selected) {
      const version = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null
      // Skip skills where version already has vtAnalysis or lacks sha256hash
      if (version?.vtAnalysis || !version?.sha256hash) continue
      results.push({
        skillId: skill._id,
        versionId: version?._id ?? null,
        sha256hash: version?.sha256hash ?? null,
        checkCount: skill.scanCheckCount ?? 0,
      })
    }

    return results
  },
})

/**
 * Health check query to monitor scan queue status
 */
export const getScanQueueHealthInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query('skills')
      .filter((q) =>
        q.and(
          q.eq(q.field('moderationStatus'), 'hidden'),
          q.eq(q.field('moderationReason'), 'pending.scan'),
        ),
      )
      .collect()

    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    const oneDayAgo = now - 24 * 60 * 60 * 1000

    let staleCount = 0
    let veryStaleCount = 0
    let oldestTimestamp = now

    for (const skill of pending) {
      const createdAt = skill.createdAt ?? skill._creationTime
      if (createdAt < oldestTimestamp) oldestTimestamp = createdAt
      if (createdAt < oneHourAgo) staleCount++
      if (createdAt < oneDayAgo) veryStaleCount++
    }

    return {
      queueSize: pending.length,
      staleCount, // pending > 1 hour
      veryStaleCount, // pending > 24 hours
      oldestAgeMinutes: Math.round((now - oldestTimestamp) / 60000),
      healthy: pending.length < 50 && veryStaleCount === 0,
    }
  },
})

/**
 * Get active skills that have a version hash but no vtAnalysis cached.
 * Used to backfill VT results for skills approved before VT integration.
 */
export const getActiveSkillsMissingVTCacheInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100
    const poolSize = limit * 2 // Take more to account for some having vtAnalysis

    // Skills waiting for VT + LLM-evaluated skills that still need VT cache
    const vtPending = await ctx.db
      .query('skills')
      .filter((q) =>
        q.and(
          q.eq(q.field('moderationStatus'), 'active'),
          q.eq(q.field('moderationReason'), 'scanner.vt.pending'),
        ),
      )
      .take(poolSize)
    const llmEvaluated = await ctx.db
      .query('skills')
      .filter((q) =>
        q.or(
          q.eq(q.field('moderationReason'), 'scanner.llm.clean'),
          q.eq(q.field('moderationReason'), 'scanner.llm.suspicious'),
          q.eq(q.field('moderationReason'), 'scanner.llm.malicious'),
        ),
      )
      .take(poolSize)

    // Dedup across pools
    const seen = new Set<string>()
    const allSkills: typeof vtPending = []
    for (const skill of [...vtPending, ...llmEvaluated]) {
      if (!seen.has(skill._id)) {
        seen.add(skill._id)
        allSkills.push(skill)
      }
    }

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      sha256hash: string
      slug: string
    }> = []

    for (const skill of allSkills) {
      if (results.length >= limit) break
      if (!skill.latestVersionId) continue
      const version = await ctx.db.get(skill.latestVersionId)
      if (!version) continue
      // Include if version has hash but no vtAnalysis
      if (version.sha256hash && !version.vtAnalysis) {
        results.push({
          skillId: skill._id,
          versionId: version._id,
          sha256hash: version.sha256hash,
          slug: skill.slug,
        })
      }
    }

    return results
  },
})

/**
 * Get all active skills with VT analysis for daily re-scan.
 */
export const getAllActiveSkillsForRescanInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const activeSkills = await ctx.db
      .query('skills')
      .filter((q) => q.eq(q.field('moderationStatus'), 'active'))
      .collect()

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      sha256hash: string
      slug: string
    }> = []

    for (const skill of activeSkills) {
      if (!skill.latestVersionId) continue
      const version = await ctx.db.get(skill.latestVersionId)
      if (!version?.sha256hash) continue

      results.push({
        skillId: skill._id,
        versionId: version._id,
        sha256hash: version.sha256hash,
        slug: skill.slug,
      })
    }

    return results
  },
})

/**
 * Cursor-based batch query for daily rescan. Uses _creationTime for stable pagination.
 * Returns a batch of active skills with sha256hash, plus a cursor and done flag.
 */
export const getActiveSkillBatchForRescanInternal = internalQuery({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100
    const cursor = args.cursor ?? 0

    // Query skills created after the cursor, ordered by _creationTime (ascending for stable pagination)
    const candidates = await ctx.db
      .query('skills')
      .filter((q) => q.gt(q.field('_creationTime'), cursor))
      .order('asc')
      .take(batchSize * 3) // Over-fetch to account for filtering

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      sha256hash: string
      slug: string
    }> = []
    let nextCursor = cursor

    for (const skill of candidates) {
      nextCursor = skill._creationTime
      if (results.length >= batchSize) break

      // Filter out soft-deleted and non-active
      if (skill.softDeletedAt) continue
      if ((skill.moderationStatus ?? 'active') !== 'active') continue
      if (!skill.latestVersionId) continue

      const version = await ctx.db.get(skill.latestVersionId)
      if (!version?.sha256hash) continue

      results.push({
        skillId: skill._id,
        versionId: version._id,
        sha256hash: version.sha256hash,
        slug: skill.slug,
      })
    }

    // Done when we got fewer candidates than our over-fetch limit
    const done = candidates.length < batchSize * 3

    return { skills: results, nextCursor, done }
  },
})

/**
 * Get active skills whose latest version has no llmAnalysis.
 * Used for LLM evaluation backfill. Same cursor pattern as getActiveSkillBatchForRescanInternal.
 */
export const getActiveSkillBatchForLlmBackfillInternal = internalQuery({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 10
    const cursor = args.cursor ?? 0

    const candidates = await ctx.db
      .query('skills')
      .filter((q) => q.gt(q.field('_creationTime'), cursor))
      .order('asc')
      .take(batchSize * 3)

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      slug: string
    }> = []
    let nextCursor = cursor

    for (const skill of candidates) {
      nextCursor = skill._creationTime
      if (results.length >= batchSize) break

      if (skill.softDeletedAt) continue
      if ((skill.moderationStatus ?? 'active') !== 'active') continue
      if (!skill.latestVersionId) continue

      const version = await ctx.db.get(skill.latestVersionId)
      if (!version) continue
      // Re-evaluate all skills (full file content reading upgrade)
      // if (version.llmAnalysis && version.llmAnalysis.status !== 'error') continue

      results.push({
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
      })
    }

    const done = candidates.length < batchSize * 3

    return { skills: results, nextCursor, done }
  },
})

/**
 * Get skills with stale moderationReason that have vtAnalysis cached.
 * Used to sync moderationReason with cached VT results.
 */
export const getSkillsWithStaleModerationReasonInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100

    // Find skills with pending-like moderationReason
    const staleReasons = new Set(['scanner.vt.pending', 'pending.scan'])
    const allSkills = await ctx.db
      .query('skills')
      .filter((q) => q.eq(q.field('moderationStatus'), 'active'))
      .collect()

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      slug: string
      currentReason: string
      vtStatus: string | null
    }> = []

    for (const skill of allSkills) {
      if (!skill.moderationReason || !staleReasons.has(skill.moderationReason)) continue
      if (!skill.latestVersionId) continue

      const version = await ctx.db.get(skill.latestVersionId)
      if (!version?.vtAnalysis?.status) continue // Skip if no vtAnalysis

      results.push({
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
        currentReason: skill.moderationReason,
        vtStatus: version.vtAnalysis.status,
      })

      if (results.length >= limit) break
    }

    return results
  },
})

/**
 * Get skills with scanner.vt.pending that need reanalysis.
 * Returns skills regardless of whether they have vtAnalysis cached.
 */
export const getPendingVTSkillsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100

    const skills = await ctx.db
      .query('skills')
      .filter((q) =>
        q.and(
          q.eq(q.field('moderationStatus'), 'active'),
          q.eq(q.field('moderationReason'), 'scanner.vt.pending'),
        ),
      )
      .take(limit)

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      slug: string
      sha256hash: string
    }> = []

    for (const skill of skills) {
      if (!skill.latestVersionId) continue
      const version = await ctx.db.get(skill.latestVersionId)
      if (!version?.sha256hash) continue

      results.push({
        skillId: skill._id,
        versionId: version._id,
        slug: skill.slug,
        sha256hash: version.sha256hash,
      })
    }

    return results
  },
})

/**
 * Update a skill's moderationReason.
 */
export const updateSkillModerationReasonInternal = internalMutation({
  args: {
    skillId: v.id('skills'),
    moderationReason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.skillId, {
      moderationReason: args.moderationReason,
    })
  },
})

/**
 * Get skills with null moderationStatus that need to be normalized.
 */
export const getSkillsWithNullModerationStatusInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100
    const skills = await ctx.db
      .query('skills')
      .filter((q) =>
        q.and(
          q.eq(q.field('moderationStatus'), undefined),
          q.eq(q.field('softDeletedAt'), undefined),
        ),
      )
      .take(limit)

    return skills.map((s) => ({
      skillId: s._id,
      slug: s.slug,
      moderationReason: s.moderationReason,
    }))
  },
})

/**
 * Set moderationStatus to 'active' for a skill.
 */
export const setSkillModerationStatusActiveInternal = internalMutation({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.skillId, {
      moderationStatus: 'active',
    })
  },
})

/**
 * Get legacy skills that are active but still have "pending.scan" reason.
 * These need to be scanned through VT to get proper verdicts.
 */
export const getLegacyPendingScanSkillsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 1000
    const skills = await ctx.db
      .query('skills')
      .filter((q) =>
        q.and(
          q.eq(q.field('moderationStatus'), 'active'),
          q.eq(q.field('moderationReason'), 'pending.scan'),
        ),
      )
      .take(limit)

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      slug: string
      hasHash: boolean
    }> = []

    for (const skill of skills) {
      if (!skill.latestVersionId) continue
      const version = await ctx.db.get(skill.latestVersionId)
      results.push({
        skillId: skill._id,
        versionId: version?._id ?? ('' as Id<'skillVersions'>),
        slug: skill.slug,
        hasHash: Boolean(version?.sha256hash),
      })
    }

    return results
  },
})

/**
 * Get active skills that bypassed VT entirely (null moderationReason).
 */
export const getUnscannedActiveSkillsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 1000
    const skills = await ctx.db
      .query('skills')
      .filter((q) =>
        q.and(
          q.eq(q.field('moderationStatus'), 'active'),
          q.eq(q.field('moderationReason'), undefined),
        ),
      )
      .take(limit)

    const results: Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      slug: string
    }> = []

    for (const skill of skills) {
      if (skill.softDeletedAt) continue
      if (!skill.latestVersionId) continue
      const version = await ctx.db.get(skill.latestVersionId)
      results.push({
        skillId: skill._id,
        versionId: version?._id ?? ('' as Id<'skillVersions'>),
        slug: skill.slug,
      })
    }

    return results
  },
})

/**
 * Update scan tracking for a skill (called after each VT check)
 */
export const updateScanCheckInternal = internalMutation({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId)
    if (!skill) return

    await ctx.db.patch(args.skillId, {
      scanLastCheckedAt: Date.now(),
      scanCheckCount: (skill.scanCheckCount ?? 0) + 1,
    })
  },
})

/**
 * Mark a skill as stale after too many failed scan checks
 * TODO: Setup webhook/notification when skills are marked stale for manual review
 */
export const markScanStaleInternal = internalMutation({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId)
    if (!skill) return

    await ctx.db.patch(args.skillId, {
      moderationReason: 'pending.scan.stale',
      updatedAt: Date.now(),
    })
  },
})

export const listVersionsInternal = internalQuery({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('skillVersions')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .collect()
  },
})

export const updateVersionScanResultsInternal = internalMutation({
  args: {
    versionId: v.id('skillVersions'),
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
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId)
    if (!version) return

    const patch: Partial<Doc<'skillVersions'>> = {}
    if (args.sha256hash !== undefined) {
      patch.sha256hash = args.sha256hash
    }
    if (args.vtAnalysis !== undefined) {
      patch.vtAnalysis = args.vtAnalysis
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.versionId, patch)
    }
  },
})

export const updateVersionLlmAnalysisInternal = internalMutation({
  args: {
    versionId: v.id('skillVersions'),
    llmAnalysis: v.object({
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
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId)
    if (!version) return
    await ctx.db.patch(args.versionId, { llmAnalysis: args.llmAnalysis })
  },
})

export const approveSkillByHashInternal = internalMutation({
  args: {
    sha256hash: v.string(),
    scanner: v.string(),
    status: v.string(),
    moderationStatus: v.optional(v.union(v.literal('active'), v.literal('hidden'))),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db
      .query('skillVersions')
      .withIndex('by_sha256hash', (q) => q.eq('sha256hash', args.sha256hash))
      .unique()

    if (!version) throw new Error('Version not found for hash')

    // Update the skill's moderation status based on scan result
    const skill = await ctx.db.get(version.skillId)
    if (skill) {
      const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null
      const isMalicious = args.status === 'malicious'
      const isSuspicious = args.status === 'suspicious'
      const isClean = !isMalicious && !isSuspicious

      // Defense-in-depth: read existing flags to merge scanner results.
      // The stricter verdict always wins across scanners.
      const existingFlags: string[] = (skill.moderationFlags as string[] | undefined) ?? []
      const existingReason: string | undefined = skill.moderationReason as string | undefined
      const alreadyBlocked = existingFlags.includes('blocked.malware')
      const alreadyFlagged = existingFlags.includes('flagged.suspicious')
      const bypassSuspicious =
        isSuspicious && !alreadyBlocked && isPrivilegedOwnerForSuspiciousBypass(owner)

      // Determine new flags based on multi-scanner merge
      let newFlags: string[] | undefined
      if (isMalicious || alreadyBlocked) {
        // Malicious from ANY scanner → blocked.malware (upgrade from suspicious)
        newFlags = ['blocked.malware']
      } else if ((isSuspicious || alreadyFlagged) && !bypassSuspicious) {
        // Suspicious from ANY scanner → flagged.suspicious
        newFlags = ['flagged.suspicious']
      } else if (isClean) {
        // Clean from this scanner — only clear if no other scanner has flagged
        const otherScannerFlagged =
          existingReason?.startsWith('scanner.') &&
          !existingReason.startsWith(`scanner.${args.scanner}.`) &&
          !existingReason.endsWith('.clean') &&
          !existingReason.endsWith('.pending')
        newFlags = otherScannerFlagged ? existingFlags : undefined
      }
      if (!alreadyBlocked && isPrivilegedOwnerForSuspiciousBypass(owner)) {
        newFlags = stripSuspiciousFlag(newFlags ?? existingFlags)
      }

      const now = Date.now()
      const qualityLocked = skill.moderationReason === 'quality.low' && !isMalicious
      const nextModerationStatus = qualityLocked ? 'hidden' : 'active'
      const nextModerationReason = qualityLocked
        ? 'quality.low'
        : bypassSuspicious
          ? `scanner.${args.scanner}.clean`
          : `scanner.${args.scanner}.${args.status}`
      const nextModerationNotes = qualityLocked
        ? (skill.moderationNotes ??
          'Quality gate quarantine is still active. Manual moderation review required.')
        : undefined

      await ctx.db.patch(skill._id, {
        moderationStatus: nextModerationStatus,
        moderationReason: nextModerationReason,
        moderationFlags: newFlags,
        moderationNotes: nextModerationNotes,
        hiddenAt: nextModerationStatus === 'hidden' ? now : undefined,
        hiddenBy: undefined,
        lastReviewedAt: nextModerationStatus === 'hidden' ? now : undefined,
        updatedAt: now,
      })

      // Auto-ban authors of malicious skills (skips moderators/admins)
      if (isMalicious && skill.ownerUserId) {
        await ctx.scheduler.runAfter(0, internal.users.autobanMalwareAuthorInternal, {
          ownerUserId: skill.ownerUserId,
          sha256hash: args.sha256hash,
          slug: skill.slug,
        })
      }
    }

    return { ok: true, skillId: version.skillId, versionId: version._id }
  },
})

/**
 * Lighter VT-only escalation: adds moderation flags and hides/bans for malicious,
 * but never touches moderationReason (preserves the LLM verdict).
 */
export const escalateByVtInternal = internalMutation({
  args: {
    sha256hash: v.string(),
    status: v.union(v.literal('malicious'), v.literal('suspicious')),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db
      .query('skillVersions')
      .withIndex('by_sha256hash', (q) => q.eq('sha256hash', args.sha256hash))
      .unique()

    if (!version) throw new Error('Version not found for hash')

    const skill = await ctx.db.get(version.skillId)
    if (!skill) return

    const isMalicious = args.status === 'malicious'
    const existingFlags: string[] = (skill.moderationFlags as string[] | undefined) ?? []
    const alreadyBlocked = existingFlags.includes('blocked.malware')
    const owner = skill.ownerUserId ? await ctx.db.get(skill.ownerUserId) : null
    const bypassSuspicious =
      !isMalicious && !alreadyBlocked && isPrivilegedOwnerForSuspiciousBypass(owner)

    // Determine new flags — stricter verdict always wins
    let newFlags: string[]
    if (isMalicious || alreadyBlocked) {
      newFlags = ['blocked.malware']
    } else if (bypassSuspicious) {
      newFlags = stripSuspiciousFlag(existingFlags) ?? []
    } else {
      newFlags = ['flagged.suspicious']
    }

    const patch: Record<string, unknown> = {
      moderationFlags: newFlags.length ? newFlags : undefined,
      updatedAt: Date.now(),
    }
    if (bypassSuspicious) {
      patch.moderationReason = normalizeScannerSuspiciousReason(
        skill.moderationReason as string | undefined,
      )
    }

    // Only hide for malicious — suspicious stays visible with a flag
    if (isMalicious) {
      patch.moderationStatus = 'hidden'
    }

    await ctx.db.patch(skill._id, patch)

    // Auto-ban authors of malicious skills
    if (isMalicious && skill.ownerUserId) {
      await ctx.scheduler.runAfter(0, internal.users.autobanMalwareAuthorInternal, {
        ownerUserId: skill.ownerUserId,
        sha256hash: args.sha256hash,
        slug: skill.slug,
      })
    }

    return { ok: true, skillId: version.skillId, versionId: version._id }
  },
})

export const getVersionBySkillAndVersion = query({
  args: { skillId: v.id('skills'), version: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query('skillVersions')
      .withIndex('by_skill_version', (q) =>
        q.eq('skillId', args.skillId).eq('version', args.version),
      )
      .unique()
  },
})

export const publishVersion: ReturnType<typeof action> = action({
  args: {
    slug: v.string(),
    displayName: v.string(),
    version: v.string(),
    changelog: v.string(),
    tags: v.optional(v.array(v.string())),
    forkOf: v.optional(
      v.object({
        slug: v.string(),
        version: v.optional(v.string()),
      }),
    ),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id('_storage'),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<PublishResult> => {
    const { userId } = await requireUserFromAction(ctx)
    return publishVersionForUser(ctx, userId, args)
  },
})

export const generateChangelogPreview = action({
  args: {
    slug: v.string(),
    version: v.string(),
    readmeText: v.string(),
    filePaths: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireUserFromAction(ctx)
    const changelog = await buildChangelogPreview(ctx, {
      slug: args.slug.trim().toLowerCase(),
      version: args.version.trim(),
      readmeText: args.readmeText,
      filePaths: args.filePaths?.map((value) => value.trim()).filter(Boolean),
    })
    return { changelog, source: 'auto' as const }
  },
})

export const getReadme: ReturnType<typeof action> = action({
  args: { versionId: v.id('skillVersions') },
  handler: async (ctx, args): Promise<ReadmeResult> => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<'skillVersions'> | null
    if (!version) throw new ConvexError('Version not found')
    const readmeFile = version.files.find(
      (file) => file.path.toLowerCase() === 'skill.md' || file.path.toLowerCase() === 'skills.md',
    )
    if (!readmeFile) throw new ConvexError('SKILL.md not found')
    const text = await fetchText(ctx, readmeFile.storageId)
    return { path: readmeFile.path, text }
  },
})

export const getFileText: ReturnType<typeof action> = action({
  args: { versionId: v.id('skillVersions'), path: v.string() },
  handler: async (ctx, args): Promise<FileTextResult> => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<'skillVersions'> | null
    if (!version) throw new ConvexError('Version not found')

    const normalizedPath = args.path.trim()
    const normalizedLower = normalizedPath.toLowerCase()
    const file =
      version.files.find((entry) => entry.path === normalizedPath) ??
      version.files.find((entry) => entry.path.toLowerCase() === normalizedLower)
    if (!file) throw new ConvexError('File not found')
    if (file.size > MAX_DIFF_FILE_BYTES) {
      throw new ConvexError('File exceeds 200KB limit')
    }

    const text = await fetchText(ctx, file.storageId)
    return { path: file.path, text, size: file.size, sha256: file.sha256 }
  },
})

export const resolveVersionByHash = query({
  args: { slug: v.string(), hash: v.string() },
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase()
    const hash = args.hash.trim().toLowerCase()
    if (!slug || !/^[a-f0-9]{64}$/.test(hash)) return null

    const skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!skill || skill.softDeletedAt) return null

    const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null

    const fingerprintMatches = await ctx.db
      .query('skillVersionFingerprints')
      .withIndex('by_skill_fingerprint', (q) => q.eq('skillId', skill._id).eq('fingerprint', hash))
      .take(25)

    let match: { version: string } | null = null
    if (fingerprintMatches.length > 0) {
      const newest = fingerprintMatches.reduce(
        (best, entry) => (entry.createdAt > best.createdAt ? entry : best),
        fingerprintMatches[0] as (typeof fingerprintMatches)[number],
      )
      const version = await ctx.db.get(newest.versionId)
      if (version && !version.softDeletedAt) {
        match = { version: version.version }
      }
    }

    if (!match) {
      const versions = await ctx.db
        .query('skillVersions')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .order('desc')
        .take(200)

      for (const version of versions) {
        if (version.softDeletedAt) continue
        if (typeof version.fingerprint === 'string' && version.fingerprint === hash) {
          match = { version: version.version }
          break
        }

        const fingerprint = await hashSkillFiles(
          version.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
        )
        if (fingerprint === hash) {
          match = { version: version.version }
          break
        }
      }
    }

    return {
      match,
      latestVersion: latestVersion ? { version: latestVersion.version } : null,
    }
  },
})

export const updateTags = mutation({
  args: {
    skillId: v.id('skills'),
    tags: v.array(v.object({ tag: v.string(), versionId: v.id('skillVersions') })),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    if (skill.ownerUserId !== user._id) {
      assertModerator(user)
    }

    const nextTags = { ...skill.tags }
    for (const entry of args.tags) {
      nextTags[entry.tag] = entry.versionId
    }

    const latestEntry = args.tags.find((entry) => entry.tag === 'latest')
    await ctx.db.patch(skill._id, {
      tags: nextTags,
      latestVersionId: latestEntry ? latestEntry.versionId : skill.latestVersionId,
      updatedAt: Date.now(),
    })

    if (latestEntry) {
      const embeddings = await ctx.db
        .query('skillEmbeddings')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .collect()
      for (const embedding of embeddings) {
        const isLatest = embedding.versionId === latestEntry.versionId
        await ctx.db.patch(embedding._id, {
          isLatest,
          visibility: embeddingVisibilityFor(isLatest, embedding.isApproved),
          updatedAt: Date.now(),
        })
      }
    }
  },
})

export const setRedactionApproved = mutation({
  args: { skillId: v.id('skills'), approved: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)

    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    if (args.approved) {
      await upsertSkillBadge(ctx, skill._id, 'redactionApproved', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill._id, 'redactionApproved')
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        isApproved: args.approved,
        visibility: embeddingVisibilityFor(embedding.isLatest, args.approved),
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.approved ? 'badge.set' : 'badge.unset',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { badge: 'redactionApproved', approved: args.approved },
      createdAt: now,
    })
  },
})

export const setBatch = mutation({
  args: { skillId: v.id('skills'), batch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    const existingBadges = await getSkillBadgeMap(ctx, skill._id)
    const previousHighlighted = isSkillHighlighted({ badges: existingBadges })
    const nextBatch = args.batch?.trim() || undefined
    const nextHighlighted = nextBatch === 'highlighted'
    const now = Date.now()

    if (nextHighlighted) {
      await upsertSkillBadge(ctx, skill._id, 'highlighted', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill._id, 'highlighted')
    }

    await ctx.db.patch(skill._id, {
      batch: nextBatch,
      updatedAt: now,
    })
    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'badge.highlighted',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { highlighted: nextHighlighted },
      createdAt: now,
    })

    if (nextHighlighted && !previousHighlighted) {
      void queueHighlightedWebhook(ctx, skill._id)
    }
  },
})

export const setSoftDeleted = mutation({
  args: { skillId: v.id('skills'), deleted: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    await ctx.db.patch(skill._id, {
      softDeletedAt: args.deleted ? now : undefined,
      moderationStatus: args.deleted ? 'hidden' : 'active',
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? user._id : undefined,
      lastReviewedAt: now,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        visibility: args.deleted
          ? 'deleted'
          : embeddingVisibilityFor(embedding.isLatest, embedding.isApproved),
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.deleted ? 'skill.delete' : 'skill.undelete',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { slug: skill.slug, softDeletedAt: args.deleted ? now : null },
      createdAt: now,
    })
  },
})

export const changeOwner = mutation({
  args: { skillId: v.id('skills'), ownerUserId: v.id('users') },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const nextOwner = await ctx.db.get(args.ownerUserId)
    if (!nextOwner || nextOwner.deletedAt || nextOwner.deactivatedAt)
      throw new Error('User not found')

    if (skill.ownerUserId === args.ownerUserId) return

    const now = Date.now()
    await ctx.db.patch(skill._id, {
      ownerUserId: args.ownerUserId,
      lastReviewedAt: now,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        ownerId: args.ownerUserId,
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'skill.owner.change',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { from: skill.ownerUserId, to: args.ownerUserId },
      createdAt: now,
    })
  },
})

/**
 * Admin-only: reclaim a squatted slug by hard-deleting the squatter's skill
 * and reserving the slug for the rightful owner.
 */
export const reclaimSlug = mutation({
  args: {
    slug: v.string(),
    rightfulOwnerUserId: v.id('users'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)

    const slug = args.slug.trim().toLowerCase()
    if (!slug) throw new Error('Slug required')

    const rightfulOwner = await ctx.db.get(args.rightfulOwnerUserId)
    if (!rightfulOwner) throw new Error('Rightful owner not found')

    const now = Date.now()

    // Check if slug is currently occupied by someone else
    const existingSkill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()

    if (existingSkill) {
      if (existingSkill.ownerUserId === args.rightfulOwnerUserId) {
        return { ok: true as const, action: 'already_owned' }
      }

      // Hard-delete the squatter's skill
      await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
        skillId: existingSkill._id,
        actorUserId: user._id,
      })

      await ctx.db.insert('auditLogs', {
        actorUserId: user._id,
        action: 'slug.reclaim',
        targetType: 'skill',
        targetId: existingSkill._id,
        metadata: {
          slug,
          squatterUserId: existingSkill.ownerUserId,
          rightfulOwnerUserId: args.rightfulOwnerUserId,
          reason: args.reason || undefined,
        },
        createdAt: now,
      })
    }

    await upsertReservedSlugForRightfulOwner(ctx, {
      slug,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
      deletedAt: now,
      expiresAt: now + SLUG_RESERVATION_MS,
      reason: args.reason || 'slug.reclaimed',
    })

    return {
      ok: true as const,
      action: existingSkill ? 'reclaimed_from_squatter' : 'reserved',
    }
  },
})

/**
 * Admin-only: reclaim slugs in bulk. Useful for recovering multiple squatted slugs at once.
 */
export const reclaimSlugInternal = internalMutation({
  args: {
    actorUserId: v.id('users'),
    slug: v.string(),
    rightfulOwnerUserId: v.id('users'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('User not found')
    assertAdmin(actor)

    const slug = args.slug.trim().toLowerCase()
    if (!slug) throw new Error('Slug required')

    const now = Date.now()

    const existingSkill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()

    if (existingSkill && existingSkill.ownerUserId !== args.rightfulOwnerUserId) {
      await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
        skillId: existingSkill._id,
        actorUserId: args.actorUserId,
      })
    }

    await upsertReservedSlugForRightfulOwner(ctx, {
      slug,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
      deletedAt: now,
      expiresAt: now + SLUG_RESERVATION_MS,
      reason: args.reason || 'slug.reclaimed',
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: args.actorUserId,
      action: 'slug.reclaim',
      targetType: 'slug',
      targetId: slug,
      metadata: {
        slug,
        rightfulOwnerUserId: args.rightfulOwnerUserId,
        hadSquatter: Boolean(existingSkill && existingSkill.ownerUserId !== args.rightfulOwnerUserId),
        reason: args.reason || undefined,
      },
      createdAt: now,
    })

    return { ok: true as const }
  },
})

export const setDuplicate = mutation({
  args: { skillId: v.id('skills'), canonicalSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertModerator(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    const canonicalSlug = args.canonicalSlug?.trim().toLowerCase()

    if (!canonicalSlug) {
      await ctx.db.patch(skill._id, {
        canonicalSkillId: undefined,
        forkOf: undefined,
        lastReviewedAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('auditLogs', {
        actorUserId: user._id,
        action: 'skill.duplicate.clear',
        targetType: 'skill',
        targetId: skill._id,
        metadata: { canonicalSlug: null },
        createdAt: now,
      })
      return
    }

    const canonical = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', canonicalSlug))
      .unique()
    if (!canonical) throw new Error('Canonical skill not found')
    if (canonical._id === skill._id) throw new Error('Cannot duplicate a skill onto itself')

    const canonicalVersion = canonical.latestVersionId
      ? await ctx.db.get(canonical.latestVersionId)
      : null

    await ctx.db.patch(skill._id, {
      canonicalSkillId: canonical._id,
      forkOf: {
        skillId: canonical._id,
        kind: 'duplicate',
        version: canonicalVersion?.version,
        at: now,
      },
      lastReviewedAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'skill.duplicate.set',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { canonicalSlug },
      createdAt: now,
    })
  },
})

export const setOfficialBadge = mutation({
  args: { skillId: v.id('skills'), official: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    if (args.official) {
      await upsertSkillBadge(ctx, skill._id, 'official', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill._id, 'official')
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.official ? 'badge.official.set' : 'badge.official.unset',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { official: args.official },
      createdAt: now,
    })
  },
})

export const setDeprecatedBadge = mutation({
  args: { skillId: v.id('skills'), deprecated: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')

    const now = Date.now()
    if (args.deprecated) {
      await upsertSkillBadge(ctx, skill._id, 'deprecated', user._id, now)
    } else {
      await removeSkillBadge(ctx, skill._id, 'deprecated')
    }

    await ctx.db.patch(skill._id, {
      lastReviewedAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: args.deprecated ? 'badge.deprecated.set' : 'badge.deprecated.unset',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { deprecated: args.deprecated },
      createdAt: now,
    })
  },
})

export const hardDelete = mutation({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx)
    assertAdmin(user)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) throw new Error('Skill not found')
    await hardDeleteSkillStep(ctx, skill, user._id, 'versions')
  },
})

export const hardDeleteInternal = internalMutation({
  args: { skillId: v.id('skills'), actorUserId: v.id('users'), phase: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId)
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error('User not found')
    assertAdmin(actor)
    const skill = await ctx.db.get(args.skillId)
    if (!skill) return
    const phase = isHardDeletePhase(args.phase) ? args.phase : 'versions'
    await hardDeleteSkillStep(ctx, skill, actor._id, phase)
  },
})

export const insertVersion = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    displayName: v.string(),
    version: v.string(),
    changelog: v.string(),
    changelogSource: v.optional(v.union(v.literal('auto'), v.literal('user'))),
    tags: v.optional(v.array(v.string())),
    fingerprint: v.string(),
    bypassNewSkillRateLimit: v.optional(v.boolean()),
    forkOf: v.optional(
      v.object({
        slug: v.string(),
        version: v.optional(v.string()),
      }),
    ),
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
    }),
    summary: v.optional(v.string()),
    qualityAssessment: v.optional(
      v.object({
        decision: v.union(v.literal('pass'), v.literal('quarantine'), v.literal('reject')),
        score: v.number(),
        reason: v.string(),
        trustTier: v.union(v.literal('low'), v.literal('medium'), v.literal('trusted')),
        similarRecentCount: v.number(),
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
      }),
    ),
    embedding: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = args.userId
    const user = await ctx.db.get(userId)
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error('User not found')

    const now = Date.now()

    let skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique()

    if (skill && skill.ownerUserId !== userId) {
      // Fallback: Convex Auth can create duplicate `users` records. Heal ownership ONLY
      // when the underlying GitHub identity matches (authAccounts.providerAccountId).
      const owner = await ctx.db.get(skill.ownerUserId)
      if (!owner || owner.deletedAt || owner.deactivatedAt) {
        throw new Error('Only the owner can publish updates')
      }

      const [ownerProviderAccountId, callerProviderAccountId] = await Promise.all([
        getGitHubProviderAccountId(ctx, skill.ownerUserId),
        getGitHubProviderAccountId(ctx, userId),
      ])

      // Deny healing when GitHub identity isn't present/consistent.
      if (
        !canHealSkillOwnershipByGitHubProviderAccountId(
          ownerProviderAccountId,
          callerProviderAccountId,
        )
      ) {
        throw new Error('Only the owner can publish updates')
      }

      await ctx.db.patch(skill._id, { ownerUserId: userId, updatedAt: now })
      skill = { ...skill, ownerUserId: userId }
    }

    const qualityAssessment = args.qualityAssessment
    const isQualityQuarantine = qualityAssessment?.decision === 'quarantine'

    // Trusted publishers (and moderators/admins) bypass auto-hide for pending scans.
    // Keep moderationReason as pending.scan so the VT poller keeps working.
    const isTrustedPublisher = Boolean(
      user.trustedPublisher || user.role === 'admin' || user.role === 'moderator',
    )
    const initialModerationStatus =
      isTrustedPublisher && !isQualityQuarantine ? 'active' : 'hidden'

    const moderationReason = isQualityQuarantine ? 'quality.low' : 'pending.scan'
    const moderationNotes = isQualityQuarantine
      ? `Auto-quarantined by quality gate (score=${qualityAssessment.score}, tier=${qualityAssessment.trustTier}, similar=${qualityAssessment.similarRecentCount}).`
      : undefined

    const qualityRecord = qualityAssessment
      ? {
          score: qualityAssessment.score,
          decision: qualityAssessment.decision,
          trustTier: qualityAssessment.trustTier,
          similarRecentCount: qualityAssessment.similarRecentCount,
          reason: qualityAssessment.reason,
          signals: qualityAssessment.signals,
          evaluatedAt: now,
        }
      : undefined

    if (!skill) {
      // Anti-squatting: enforce reserved slug cooldown.
      await enforceReservedSlugCooldownForNewSkill(ctx, { slug: args.slug, userId, now })

      if (!args.bypassNewSkillRateLimit) {
        const ownerTrustSignals = await getOwnerTrustSignals(ctx, user, now)
        enforceNewSkillRateLimit(ownerTrustSignals)
      }

      const forkOfSlug = args.forkOf?.slug.trim().toLowerCase() || ''
      const forkOfVersion = args.forkOf?.version?.trim() || undefined

      let canonicalSkillId: Id<'skills'> | undefined
      let forkOf:
        | {
            skillId: Id<'skills'>
            kind: 'fork' | 'duplicate'
            version?: string
            at: number
          }
        | undefined

      if (forkOfSlug) {
        const upstream = await ctx.db
          .query('skills')
          .withIndex('by_slug', (q) => q.eq('slug', forkOfSlug))
          .unique()
        if (!upstream || upstream.softDeletedAt) throw new Error('Upstream skill not found')
        canonicalSkillId = upstream.canonicalSkillId ?? upstream._id
        forkOf = {
          skillId: upstream._id,
          kind: 'fork',
          version: forkOfVersion,
          at: now,
        }
      } else {
        const match = await findCanonicalSkillForFingerprint(ctx, args.fingerprint)
        if (match) {
          canonicalSkillId = match.canonicalSkillId ?? match._id
          forkOf = {
            skillId: match._id,
            kind: 'duplicate',
            at: now,
          }
        }
      }

      const summary = args.summary ?? getFrontmatterValue(args.parsed.frontmatter, 'description')
      const summaryValue = summary ?? undefined
      const moderationFlags = deriveModerationFlags({
        skill: { slug: args.slug, displayName: args.displayName, summary: summaryValue },
        parsed: args.parsed,
        files: args.files,
      })
      const skillId = await ctx.db.insert('skills', {
        slug: args.slug,
        displayName: args.displayName,
        summary: summaryValue,
        ownerUserId: userId,
        canonicalSkillId,
        forkOf,
        latestVersionId: undefined,
        tags: {},
        softDeletedAt: undefined,
        badges: {
          redactionApproved: undefined,
          highlighted: undefined,
          official: undefined,
          deprecated: undefined,
        },
        moderationStatus: initialModerationStatus,
        moderationReason,
        moderationNotes,
        quality: qualityRecord,
        moderationFlags: moderationFlags.length ? moderationFlags : undefined,
        reportCount: 0,
        lastReportedAt: undefined,
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 0,
        stats: {
          downloads: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          stars: 0,
          versions: 0,
          comments: 0,
        },
        createdAt: now,
        updatedAt: now,
      })
      skill = await ctx.db.get(skillId)
    }

    if (!skill) throw new Error('Skill creation failed')

    const existingVersion = await ctx.db
      .query('skillVersions')
      .withIndex('by_skill_version', (q) => q.eq('skillId', skill._id).eq('version', args.version))
      .unique()
    if (existingVersion) {
      throw new Error('Version already exists')
    }

    const versionId = await ctx.db.insert('skillVersions', {
      skillId: skill._id,
      version: args.version,
      fingerprint: args.fingerprint,
      changelog: args.changelog,
      changelogSource: args.changelogSource,
      files: args.files,
      parsed: args.parsed,
      createdBy: userId,
      createdAt: now,
      softDeletedAt: undefined,
    })

    const nextTags: Record<string, Id<'skillVersions'>> = { ...skill.tags }
    nextTags.latest = versionId
    for (const tag of args.tags ?? []) {
      nextTags[tag] = versionId
    }

    const latestBefore = skill.latestVersionId

    const nextSummary =
      args.summary ?? getFrontmatterValue(args.parsed.frontmatter, 'description') ?? skill.summary
    const moderationFlags = deriveModerationFlags({
      skill: { slug: skill.slug, displayName: args.displayName, summary: nextSummary ?? undefined },
      parsed: args.parsed,
      files: args.files,
    })

    await ctx.db.patch(skill._id, {
      displayName: args.displayName,
      summary: nextSummary ?? undefined,
      latestVersionId: versionId,
      tags: nextTags,
      stats: { ...skill.stats, versions: skill.stats.versions + 1 },
      softDeletedAt: undefined,
      moderationStatus: initialModerationStatus,
      moderationReason,
      moderationNotes,
      quality: qualityRecord ?? skill.quality,
      moderationFlags: moderationFlags.length ? moderationFlags : undefined,
      updatedAt: now,
    })

    const badgeMap = await getSkillBadgeMap(ctx, skill._id)
    const isApproved = Boolean(badgeMap.redactionApproved)

    const embeddingId = await ctx.db.insert('skillEmbeddings', {
      skillId: skill._id,
      versionId,
      ownerId: userId,
      embedding: args.embedding,
      isLatest: true,
      isApproved,
      visibility: embeddingVisibilityFor(true, isApproved),
      updatedAt: now,
    })

    if (latestBefore) {
      const previousEmbedding = await ctx.db
        .query('skillEmbeddings')
        .withIndex('by_version', (q) => q.eq('versionId', latestBefore))
        .unique()
      if (previousEmbedding) {
        await ctx.db.patch(previousEmbedding._id, {
          isLatest: false,
          visibility: embeddingVisibilityFor(false, previousEmbedding.isApproved),
          updatedAt: now,
        })
      }
    }

    await ctx.db.insert('skillVersionFingerprints', {
      skillId: skill._id,
      versionId,
      fingerprint: args.fingerprint,
      createdAt: now,
    })

    return { skillId: skill._id, versionId, embeddingId }
  },
})

export const setSkillSoftDeletedInternal = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    deleted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error('User not found')

    const slug = args.slug.trim().toLowerCase()
    if (!slug) throw new Error('Slug required')

    const skill = await ctx.db
      .query('skills')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!skill) throw new Error('Skill not found')

    if (skill.ownerUserId !== args.userId) {
      assertModerator(user)
    }

    const now = Date.now()
    await ctx.db.patch(skill._id, {
      softDeletedAt: args.deleted ? now : undefined,
      moderationStatus: args.deleted ? 'hidden' : 'active',
      hiddenAt: args.deleted ? now : undefined,
      hiddenBy: args.deleted ? args.userId : undefined,
      lastReviewedAt: now,
      updatedAt: now,
    })

    const embeddings = await ctx.db
      .query('skillEmbeddings')
      .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
      .collect()
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        visibility: args.deleted
          ? 'deleted'
          : embeddingVisibilityFor(embedding.isLatest, embedding.isApproved),
        updatedAt: now,
      })
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: args.userId,
      action: args.deleted ? 'skill.delete' : 'skill.undelete',
      targetType: 'skill',
      targetId: skill._id,
      metadata: { slug, softDeletedAt: args.deleted ? now : null },
      createdAt: now,
    })

    return { ok: true as const }
  },
})

function clampInt(value: number, min: number, max: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : min
  return Math.min(max, Math.max(min, rounded))
}

async function findCanonicalSkillForFingerprint(
  ctx: { db: MutationCtx['db'] },
  fingerprint: string,
) {
  const matches = await ctx.db
    .query('skillVersionFingerprints')
    .withIndex('by_fingerprint', (q) => q.eq('fingerprint', fingerprint))
    .take(25)

  for (const entry of matches) {
    const skill = await ctx.db.get(entry.skillId)
    if (!skill || skill.softDeletedAt) continue
    return skill
  }

  return null
}
