import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { action, internalAction, internalMutation, internalQuery } from './_generated/server'
import { assertRole, requireUserFromAction } from './lib/access'
import { buildSkillSummaryBackfillPatch, type ParsedSkillData } from './lib/skillBackfill'
import { hashSkillFiles } from './lib/skills'

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 200
const DEFAULT_MAX_BATCHES = 20
const MAX_MAX_BATCHES = 200

type BackfillStats = {
  skillsScanned: number
  skillsPatched: number
  versionsPatched: number
  missingLatestVersion: number
  missingReadme: number
  missingStorageBlob: number
}

type BackfillPageItem =
  | {
      kind: 'ok'
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      skillSummary: Doc<'skills'>['summary']
      versionParsed: Doc<'skillVersions'>['parsed']
      readmeStorageId: Id<'_storage'>
    }
  | { kind: 'missingLatestVersion'; skillId: Id<'skills'> }
  | { kind: 'missingVersionDoc'; skillId: Id<'skills'>; versionId: Id<'skillVersions'> }
  | { kind: 'missingReadme'; skillId: Id<'skills'>; versionId: Id<'skillVersions'> }

type BackfillPageResult = {
  items: BackfillPageItem[]
  cursor: string | null
  isDone: boolean
}

export const getSkillBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: BackfillPageItem[] = []
    for (const skill of page) {
      if (!skill.latestVersionId) {
        items.push({ kind: 'missingLatestVersion', skillId: skill._id })
        continue
      }

      const version = await ctx.db.get(skill.latestVersionId)
      if (!version) {
        items.push({
          kind: 'missingVersionDoc',
          skillId: skill._id,
          versionId: skill.latestVersionId,
        })
        continue
      }

      const readmeFile = version.files.find(
        (file) => file.path.toLowerCase() === 'skill.md' || file.path.toLowerCase() === 'skills.md',
      )
      if (!readmeFile) {
        items.push({ kind: 'missingReadme', skillId: skill._id, versionId: version._id })
        continue
      }

      items.push({
        kind: 'ok',
        skillId: skill._id,
        versionId: version._id,
        skillSummary: skill.summary,
        versionParsed: version.parsed,
        readmeStorageId: readmeFile.storageId,
      })
    }

    return { items, cursor: continueCursor, isDone }
  },
})

export const applySkillBackfillPatchInternal = internalMutation({
  args: {
    skillId: v.id('skills'),
    versionId: v.id('skillVersions'),
    summary: v.optional(v.string()),
    parsed: v.optional(
      v.object({
        frontmatter: v.record(v.string(), v.any()),
        metadata: v.optional(v.any()),
        clawdis: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    if (typeof args.summary === 'string') {
      await ctx.db.patch(args.skillId, { summary: args.summary, updatedAt: now })
    }
    if (args.parsed) {
      await ctx.db.patch(args.versionId, { parsed: args.parsed })
    }
    return { ok: true as const }
  },
})

export type BackfillActionArgs = {
  dryRun?: boolean
  batchSize?: number
  maxBatches?: number
}

export type BackfillActionResult = { ok: true; stats: BackfillStats }

export async function backfillSkillSummariesInternalHandler(
  ctx: ActionCtx,
  args: BackfillActionArgs,
): Promise<BackfillActionResult> {
  const dryRun = Boolean(args.dryRun)
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)

  const totals: BackfillStats = {
    skillsScanned: 0,
    skillsPatched: 0,
    versionsPatched: 0,
    missingLatestVersion: 0,
    missingReadme: 0,
    missingStorageBlob: 0,
  }

  let cursor: string | null = null
  let isDone = false

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as BackfillPageResult

    cursor = page.cursor
    isDone = page.isDone

    for (const item of page.items) {
      totals.skillsScanned++
      if (item.kind === 'missingLatestVersion') {
        totals.missingLatestVersion++
        continue
      }
      if (item.kind === 'missingVersionDoc') {
        totals.missingLatestVersion++
        continue
      }
      if (item.kind === 'missingReadme') {
        totals.missingReadme++
        continue
      }

      const blob = await ctx.storage.get(item.readmeStorageId)
      if (!blob) {
        totals.missingStorageBlob++
        continue
      }

      const readmeText = await blob.text()
      const patch = buildSkillSummaryBackfillPatch({
        readmeText,
        currentSummary: item.skillSummary ?? undefined,
        currentParsed: item.versionParsed as ParsedSkillData,
      })

      if (!patch.summary && !patch.parsed) continue
      if (patch.summary) totals.skillsPatched++
      if (patch.parsed) totals.versionsPatched++

      if (dryRun) continue

      await ctx.runMutation(internal.maintenance.applySkillBackfillPatchInternal, {
        skillId: item.skillId,
        versionId: item.versionId,
        summary: patch.summary,
        parsed: patch.parsed,
      })
    }

    if (isDone) break
  }

  if (!isDone) {
    throw new ConvexError('Backfill incomplete (maxBatches reached)')
  }

  return { ok: true as const, stats: totals }
}

export const backfillSkillSummariesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillSummariesInternalHandler,
})

export const backfillSkillSummaries: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runAction(
      internal.maintenance.backfillSkillSummariesInternal,
      args,
    ) as Promise<BackfillActionResult>
  },
})

export const scheduleBackfillSkillSummaries: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillSummariesInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    })
    return { ok: true as const }
  },
})

type FingerprintBackfillStats = {
  versionsScanned: number
  versionsPatched: number
  fingerprintsInserted: number
  fingerprintMismatches: number
}

type FingerprintBackfillPageItem = {
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'>
  versionFingerprint?: string
  files: Array<{ path: string; sha256: string }>
  existingEntries: Array<{ id: Id<'skillVersionFingerprints'>; fingerprint: string }>
}

type FingerprintBackfillPageResult = {
  items: FingerprintBackfillPageItem[]
  cursor: string | null
  isDone: boolean
}

type BadgeKind = Doc<'resourceBadges'>['kind']

type LegacySkillBadges = Partial<Record<BadgeKind, { byUserId: Id<'users'>; at: number }>>

type SkillBadgeTableBackfillStats = {
  skillsScanned: number
  recordsInserted: number
}

type BadgeBackfillPageItem = {
  skillId: Id<'skills'>
  resourceId?: Id<'resources'>
  ownerUserId: Id<'users'>
  createdAt?: number
  updatedAt?: number
  batch?: string
  legacyBadges?: LegacySkillBadges
}

type BadgeBackfillPageResult = {
  items: BadgeBackfillPageItem[]
  cursor: string | null
  isDone: boolean
}

type ModerationBackfillStats = {
  skillsScanned: number
  recordsUpserted: number
}

type ModerationBackfillPageItem = {
  skillId: Id<'skills'>
  notes?: string
  reason?: string
  reviewedAt?: number
  hiddenAt?: number
  hiddenBy?: Id<'users'>
}

type ModerationBackfillPageResult = {
  items: ModerationBackfillPageItem[]
  cursor: string | null
  isDone: boolean
}

type ReportStatsBackfillStats = {
  skillsScanned: number
  recordsUpserted: number
}

type ReportStatsBackfillPageItem = {
  skillId: Id<'skills'>
  reportCount?: number
  lastReportedAt?: number
}

type ReportStatsBackfillPageResult = {
  items: ReportStatsBackfillPageItem[]
  cursor: string | null
  isDone: boolean
}

type ResourceBackfillStats = {
  skillsScanned: number
  skillsUpdated: number
  soulsScanned: number
  soulsUpdated: number
  resourcesInserted: number
}

type ResourceBadgeBackfillStats = {
  badgesScanned: number
  badgesInserted: number
  badgesSkipped: number
}

export const getSkillFingerprintBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FingerprintBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skillVersions')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: FingerprintBackfillPageItem[] = []
    for (const version of page) {
      const existingEntries = await ctx.db
        .query('skillVersionFingerprints')
        .withIndex('by_version', (q) => q.eq('versionId', version._id))
        .take(20)

      const normalizedFiles = version.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
      }))

      const hasAnyEntry = existingEntries.length > 0
      const entryFingerprints = new Set(existingEntries.map((entry) => entry.fingerprint))
      const hasFingerprintMismatch =
        typeof version.fingerprint === 'string' &&
        hasAnyEntry &&
        (entryFingerprints.size !== 1 || !entryFingerprints.has(version.fingerprint))
      const needsFingerprintField = !version.fingerprint
      const needsFingerprintEntry = !hasAnyEntry

      if (!needsFingerprintField && !needsFingerprintEntry && !hasFingerprintMismatch) continue

      items.push({
        skillId: version.skillId,
        versionId: version._id,
        versionFingerprint: version.fingerprint ?? undefined,
        files: normalizedFiles,
        existingEntries: existingEntries.map((entry) => ({
          id: entry._id,
          fingerprint: entry.fingerprint,
        })),
      })
    }

    return { items, cursor: continueCursor, isDone }
  },
})

export const applySkillFingerprintBackfillPatchInternal = internalMutation({
  args: {
    versionId: v.id('skillVersions'),
    fingerprint: v.string(),
    patchVersion: v.boolean(),
    replaceEntries: v.boolean(),
    existingEntryIds: v.optional(v.array(v.id('skillVersionFingerprints'))),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId)
    if (!version) return { ok: false as const, reason: 'missingVersion' as const }

    const now = Date.now()

    if (args.patchVersion) {
      await ctx.db.patch(version._id, { fingerprint: args.fingerprint })
    }

    if (args.replaceEntries) {
      const existing = args.existingEntryIds ?? []
      for (const id of existing) {
        await ctx.db.delete(id)
      }

      await ctx.db.insert('skillVersionFingerprints', {
        skillId: version.skillId,
        versionId: version._id,
        fingerprint: args.fingerprint,
        createdAt: now,
      })
    }

    return { ok: true as const }
  },
})

export type FingerprintBackfillActionArgs = {
  dryRun?: boolean
  batchSize?: number
  maxBatches?: number
}

export type FingerprintBackfillActionResult = { ok: true; stats: FingerprintBackfillStats }

export async function backfillSkillFingerprintsInternalHandler(
  ctx: ActionCtx,
  args: FingerprintBackfillActionArgs,
): Promise<FingerprintBackfillActionResult> {
  const dryRun = Boolean(args.dryRun)
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)

  const totals: FingerprintBackfillStats = {
    versionsScanned: 0,
    versionsPatched: 0,
    fingerprintsInserted: 0,
    fingerprintMismatches: 0,
  }

  let cursor: string | null = null
  let isDone = false

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillFingerprintBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as FingerprintBackfillPageResult

    cursor = page.cursor
    isDone = page.isDone

    for (const item of page.items) {
      totals.versionsScanned++

      const fingerprint = await hashSkillFiles(item.files)

      const existingFingerprints = new Set(item.existingEntries.map((entry) => entry.fingerprint))
      const hasAnyEntry = item.existingEntries.length > 0
      const entryIsCorrect =
        hasAnyEntry && existingFingerprints.size === 1 && existingFingerprints.has(fingerprint)
      const versionFingerprintIsCorrect = item.versionFingerprint === fingerprint

      if (hasAnyEntry && !entryIsCorrect) totals.fingerprintMismatches++

      const shouldPatchVersion = !versionFingerprintIsCorrect
      const shouldReplaceEntries = !entryIsCorrect
      if (!shouldPatchVersion && !shouldReplaceEntries) continue

      if (shouldPatchVersion) totals.versionsPatched++
      if (shouldReplaceEntries) totals.fingerprintsInserted++

      if (dryRun) continue

      await ctx.runMutation(internal.maintenance.applySkillFingerprintBackfillPatchInternal, {
        versionId: item.versionId,
        fingerprint,
        patchVersion: shouldPatchVersion,
        replaceEntries: shouldReplaceEntries,
        existingEntryIds: shouldReplaceEntries ? item.existingEntries.map((entry) => entry.id) : [],
      })
    }

    if (isDone) break
  }

  if (!isDone) {
    throw new ConvexError('Backfill incomplete (maxBatches reached)')
  }

  return { ok: true as const, stats: totals }
}

export const backfillSkillFingerprintsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillFingerprintsInternalHandler,
})

export const backfillSkillFingerprints: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FingerprintBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runAction(
      internal.maintenance.backfillSkillFingerprintsInternal,
      args,
    ) as Promise<FingerprintBackfillActionResult>
  },
})

export const scheduleBackfillSkillFingerprints: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillFingerprintsInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    })
    return { ok: true as const }
  },
})

export const getSkillBadgeBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BadgeBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: BadgeBackfillPageItem[] = page.map((skill) => {
      const legacyBadges = (skill as Doc<'skills'> & { badges?: LegacySkillBadges }).badges
      return {
        skillId: skill._id,
        resourceId: skill.resourceId ?? undefined,
        ownerUserId: skill.ownerUserId,
        createdAt: skill.createdAt ?? undefined,
        updatedAt: skill.updatedAt ?? undefined,
        batch: skill.batch ?? undefined,
        legacyBadges: legacyBadges ?? undefined,
      }
    })

    return { items, cursor: continueCursor, isDone }
  },
})

export const upsertResourceBadgeRecordInternal = internalMutation({
  args: {
    resourceId: v.id('resources'),
    kind: v.union(
      v.literal('highlighted'),
      v.literal('official'),
      v.literal('deprecated'),
      v.literal('redactionApproved'),
    ),
    byUserId: v.id('users'),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('resourceBadges')
      .withIndex('by_resource_kind', (q) =>
        q.eq('resourceId', args.resourceId).eq('kind', args.kind),
      )
      .unique()
    if (existing) return { inserted: false as const }
    await ctx.db.insert('resourceBadges', {
      resourceId: args.resourceId,
      kind: args.kind,
      byUserId: args.byUserId,
      at: args.at,
    })
    return { inserted: true as const }
  },
})

export type BadgeBackfillActionArgs = {
  dryRun?: boolean
  batchSize?: number
  maxBatches?: number
}

export type SkillBadgeTableBackfillActionResult = {
  ok: true
  stats: SkillBadgeTableBackfillStats
}

export async function backfillSkillBadgeTableInternalHandler(
  ctx: ActionCtx,
  args: BadgeBackfillActionArgs,
): Promise<SkillBadgeTableBackfillActionResult> {
  const dryRun = Boolean(args.dryRun)
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)

  const totals: SkillBadgeTableBackfillStats = {
    skillsScanned: 0,
    recordsInserted: 0,
  }

  let cursor: string | null = null
  let isDone = false

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillBadgeBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as BadgeBackfillPageResult

    cursor = page.cursor
    isDone = page.isDone

    for (const item of page.items) {
      totals.skillsScanned++
      if (!item.resourceId) continue
      const badges = item.legacyBadges ?? {}
      const entries: Array<{ kind: BadgeKind; byUserId: Id<'users'>; at: number }> = []

      if (badges.redactionApproved) {
        entries.push({
          kind: 'redactionApproved',
          byUserId: badges.redactionApproved.byUserId,
          at: badges.redactionApproved.at,
        })
      }

      if (badges.official) {
        entries.push({
          kind: 'official',
          byUserId: badges.official.byUserId,
          at: badges.official.at,
        })
      }

      if (badges.deprecated) {
        entries.push({
          kind: 'deprecated',
          byUserId: badges.deprecated.byUserId,
          at: badges.deprecated.at,
        })
      }

      const highlighted =
        badges.highlighted ??
        (item.batch === 'highlighted'
          ? {
              byUserId: item.ownerUserId,
              at: item.updatedAt ?? item.createdAt ?? Date.now(),
            }
          : undefined)

      if (highlighted) {
        entries.push({
          kind: 'highlighted',
          byUserId: highlighted.byUserId,
          at: highlighted.at,
        })
      }

      if (entries.length === 0) continue
      if (dryRun) continue

      for (const entry of entries) {
        const result = await ctx.runMutation(
          internal.maintenance.upsertResourceBadgeRecordInternal,
          {
            resourceId: item.resourceId,
            kind: entry.kind,
            byUserId: entry.byUserId,
            at: entry.at,
          },
        )
        if (result.inserted) {
          totals.recordsInserted++
        }
      }
    }

    if (isDone) break
  }

  if (!isDone) {
    throw new ConvexError('Backfill incomplete (maxBatches reached)')
  }

  return { ok: true as const, stats: totals }
}

export const backfillSkillBadgeTableInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillBadgeTableInternalHandler,
})

export const backfillSkillBadgeTable: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SkillBadgeTableBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runAction(
      internal.maintenance.backfillSkillBadgeTableInternal,
      args,
    ) as Promise<SkillBadgeTableBackfillActionResult>
  },
})

export const scheduleBackfillSkillBadgeTable: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillBadgeTableInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    })
    return { ok: true as const }
  },
})

export const getSkillModerationBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ModerationBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: ModerationBackfillPageItem[] = page.map((skill) => {
      const legacy = skill as Doc<'skills'> & {
        moderationNotes?: string
        moderationReason?: string
        lastReviewedAt?: number
        hiddenAt?: number
        hiddenBy?: Id<'users'>
      }
      return {
        skillId: skill._id,
        notes: legacy.moderationNotes ?? undefined,
        reason: legacy.moderationReason ?? undefined,
        reviewedAt: legacy.lastReviewedAt ?? undefined,
        hiddenAt: legacy.hiddenAt ?? undefined,
        hiddenBy: legacy.hiddenBy ?? undefined,
      }
    })

    return { items, cursor: continueCursor, isDone }
  },
})

export const upsertSkillModerationRecordInternal = internalMutation({
  args: {
    skillId: v.id('skills'),
    notes: v.optional(v.string()),
    reason: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    hiddenAt: v.optional(v.number()),
    hiddenBy: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('skillModeration')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .unique()

    const patch: Partial<Doc<'skillModeration'>> = {}
    if (typeof args.notes === 'string' && !existing?.notes) patch.notes = args.notes
    if (typeof args.reason === 'string' && !existing?.reason) patch.reason = args.reason
    if (typeof args.reviewedAt === 'number' && !existing?.reviewedAt) {
      patch.reviewedAt = args.reviewedAt
    }
    if (typeof args.hiddenAt === 'number' && !existing?.hiddenAt) patch.hiddenAt = args.hiddenAt
    if (args.hiddenBy && !existing?.hiddenBy) patch.hiddenBy = args.hiddenBy

    if (Object.keys(patch).length === 0) {
      return { upserted: false as const }
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch)
      return { upserted: true as const, inserted: false as const }
    }

    await ctx.db.insert('skillModeration', { skillId: args.skillId, ...patch })
    return { upserted: true as const, inserted: true as const }
  },
})

export type ModerationBackfillActionResult = { ok: true; stats: ModerationBackfillStats }

export async function backfillSkillModerationInternalHandler(
  ctx: ActionCtx,
  args: BadgeBackfillActionArgs,
): Promise<ModerationBackfillActionResult> {
  const dryRun = Boolean(args.dryRun)
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)

  const totals: ModerationBackfillStats = {
    skillsScanned: 0,
    recordsUpserted: 0,
  }

  let cursor: string | null = null
  let isDone = false

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillModerationBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as ModerationBackfillPageResult

    cursor = page.cursor
    isDone = page.isDone

    for (const item of page.items) {
      totals.skillsScanned++

      const hasValues =
        typeof item.notes === 'string' ||
        typeof item.reason === 'string' ||
        typeof item.reviewedAt === 'number' ||
        typeof item.hiddenAt === 'number' ||
        Boolean(item.hiddenBy)
      if (!hasValues) continue

      totals.recordsUpserted++
      if (dryRun) continue

      await ctx.runMutation(internal.maintenance.upsertSkillModerationRecordInternal, {
        skillId: item.skillId,
        notes: item.notes,
        reason: item.reason,
        reviewedAt: item.reviewedAt,
        hiddenAt: item.hiddenAt,
        hiddenBy: item.hiddenBy,
      })
    }

    if (isDone) break
  }

  if (!isDone) {
    throw new ConvexError('Backfill incomplete (maxBatches reached)')
  }

  return { ok: true as const, stats: totals }
}

export const backfillSkillModerationInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillModerationInternalHandler,
})

export const backfillSkillModeration: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ModerationBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runAction(
      internal.maintenance.backfillSkillModerationInternal,
      args,
    ) as Promise<ModerationBackfillActionResult>
  },
})

export const scheduleBackfillSkillModeration: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillModerationInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    })
    return { ok: true as const }
  },
})

export const getSkillReportStatsBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ReportStatsBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: ReportStatsBackfillPageItem[] = page.map((skill) => {
      const legacy = skill as Doc<'skills'> & {
        reportCount?: number
        lastReportedAt?: number
      }
      return {
        skillId: skill._id,
        reportCount: legacy.reportCount ?? undefined,
        lastReportedAt: legacy.lastReportedAt ?? undefined,
      }
    })

    return { items, cursor: continueCursor, isDone }
  },
})

export const upsertSkillReportStatsInternal = internalMutation({
  args: {
    skillId: v.id('skills'),
    reportCount: v.number(),
    lastReportedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('skillReportStats')
      .withIndex('by_skill', (q) => q.eq('skillId', args.skillId))
      .unique()
    if (existing) return { inserted: false as const }
    await ctx.db.insert('skillReportStats', {
      skillId: args.skillId,
      reportCount: args.reportCount,
      lastReportedAt: args.lastReportedAt ?? undefined,
    })
    return { inserted: true as const }
  },
})

export type ReportStatsBackfillActionResult = { ok: true; stats: ReportStatsBackfillStats }

export async function backfillSkillReportStatsInternalHandler(
  ctx: ActionCtx,
  args: BadgeBackfillActionArgs,
): Promise<ReportStatsBackfillActionResult> {
  const dryRun = Boolean(args.dryRun)
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)

  const totals: ReportStatsBackfillStats = {
    skillsScanned: 0,
    recordsUpserted: 0,
  }

  let cursor: string | null = null
  let isDone = false

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillReportStatsBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as ReportStatsBackfillPageResult

    cursor = page.cursor
    isDone = page.isDone

    for (const item of page.items) {
      totals.skillsScanned++
      const hasReportCount = typeof item.reportCount === 'number' && item.reportCount > 0
      const hasLastReportedAt = typeof item.lastReportedAt === 'number'
      if (!hasReportCount && !hasLastReportedAt) continue

      totals.recordsUpserted++
      if (dryRun) continue

      await ctx.runMutation(internal.maintenance.upsertSkillReportStatsInternal, {
        skillId: item.skillId,
        reportCount: item.reportCount ?? 0,
        lastReportedAt: item.lastReportedAt,
      })
    }

    if (isDone) break
  }

  if (!isDone) {
    throw new ConvexError('Backfill incomplete (maxBatches reached)')
  }

  return { ok: true as const, stats: totals }
}

export const backfillSkillReportStatsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillReportStatsInternalHandler,
})

export const backfillSkillReportStats: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ReportStatsBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runAction(
      internal.maintenance.backfillSkillReportStatsInternal,
      args,
    ) as Promise<ReportStatsBackfillActionResult>
  },
})

export const scheduleBackfillSkillReportStats: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillReportStatsInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    })
    return { ok: true as const }
  },
})

type SkillResourceBackfillPageItem = {
  skillId: Id<'skills'>
  hasResource: boolean
  hasOwnerHandle: boolean
}

type SoulResourceBackfillPageItem = {
  soulId: Id<'souls'>
  hasResource: boolean
  hasOwnerHandle: boolean
}

type ResourceBackfillPageResult<T> = {
  items: T[]
  cursor: string | null
  isDone: boolean
}

export const getSkillResourceBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<ResourceBackfillPageResult<SkillResourceBackfillPageItem>> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: SkillResourceBackfillPageItem[] = []
    for (const skill of page) {
      const resource = skill.resourceId ? await ctx.db.get(skill.resourceId) : null
      items.push({
        skillId: skill._id,
        hasResource: Boolean(resource),
        hasOwnerHandle: Boolean(resource?.ownerHandle),
      })
    }

    return { items, cursor: continueCursor, isDone }
  },
})

export const getSoulResourceBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ResourceBackfillPageResult<SoulResourceBackfillPageItem>> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('souls')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    const items: SoulResourceBackfillPageItem[] = []
    for (const soul of page) {
      const resource = soul.resourceId ? await ctx.db.get(soul.resourceId) : null
      items.push({
        soulId: soul._id,
        hasResource: Boolean(resource),
        hasOwnerHandle: Boolean(resource?.ownerHandle),
      })
    }

    return { items, cursor: continueCursor, isDone }
  },
})

export const upsertSkillResourceInternal = internalMutation({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId)
    if (!skill) return { ok: false as const, inserted: false as const }

    const owner = await ctx.db.get(skill.ownerUserId)
    const ownerHandle = owner?.handle ?? owner?._id ?? undefined

    if (skill.resourceId) {
      const existing = await ctx.db.get(skill.resourceId)
      if (existing) {
        if (!existing.ownerHandle) {
          await ctx.db.patch(existing._id, { ownerHandle })
        }
        return { ok: true as const, inserted: false as const }
      }
    }

    const resourceId = await ctx.db.insert('resources', {
      type: 'skill',
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary,
      ownerUserId: skill.ownerUserId,
      ownerHandle,
      softDeletedAt: skill.softDeletedAt,
      statsDownloads: skill.statsDownloads,
      statsStars: skill.statsStars,
      statsInstallsCurrent: skill.statsInstallsCurrent,
      statsInstallsAllTime: skill.statsInstallsAllTime,
      stats: skill.stats,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    })

    await ctx.db.patch(skill._id, { resourceId })
    return { ok: true as const, inserted: true as const }
  },
})

export const upsertSoulResourceInternal = internalMutation({
  args: { soulId: v.id('souls') },
  handler: async (ctx, args) => {
    const soul = await ctx.db.get(args.soulId)
    if (!soul) return { ok: false as const, inserted: false as const }

    const owner = await ctx.db.get(soul.ownerUserId)
    const ownerHandle = owner?.handle ?? owner?._id ?? undefined

    if (soul.resourceId) {
      const existing = await ctx.db.get(soul.resourceId)
      if (existing) {
        if (!existing.ownerHandle) {
          await ctx.db.patch(existing._id, { ownerHandle })
        }
        return { ok: true as const, inserted: false as const }
      }
    }

    const resourceId = await ctx.db.insert('resources', {
      type: 'soul',
      slug: soul.slug,
      displayName: soul.displayName,
      summary: soul.summary,
      ownerUserId: soul.ownerUserId,
      ownerHandle,
      softDeletedAt: soul.softDeletedAt,
      statsDownloads: soul.stats.downloads,
      statsStars: soul.stats.stars,
      statsInstallsCurrent: undefined,
      statsInstallsAllTime: undefined,
      stats: {
        downloads: soul.stats.downloads,
        stars: soul.stats.stars,
        versions: soul.stats.versions,
        comments: soul.stats.comments,
      },
      createdAt: soul.createdAt,
      updatedAt: soul.updatedAt,
    })

    await ctx.db.patch(soul._id, { resourceId })
    return { ok: true as const, inserted: true as const }
  },
})

export type ResourceBackfillActionResult = { ok: true; stats: ResourceBackfillStats }

export async function backfillResourcesInternalHandler(
  ctx: ActionCtx,
  args: BadgeBackfillActionArgs,
): Promise<ResourceBackfillActionResult> {
  const dryRun = Boolean(args.dryRun)
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)

  const totals: ResourceBackfillStats = {
    skillsScanned: 0,
    skillsUpdated: 0,
    soulsScanned: 0,
    soulsUpdated: 0,
    resourcesInserted: 0,
  }

  let cursor: string | null = null
  let isDone = false

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillResourceBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as ResourceBackfillPageResult<SkillResourceBackfillPageItem>

    cursor = page.cursor
    isDone = page.isDone

    for (const item of page.items) {
      totals.skillsScanned++
      if (item.hasResource && item.hasOwnerHandle) continue
      totals.skillsUpdated++
      if (dryRun) continue

      const result = await ctx.runMutation(internal.maintenance.upsertSkillResourceInternal, {
        skillId: item.skillId,
      })
      if (result.inserted) totals.resourcesInserted++
    }

    if (isDone) break
  }

  if (!isDone) {
    throw new ConvexError('Skill resource backfill incomplete (maxBatches reached)')
  }

  cursor = null
  isDone = false

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSoulResourceBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as ResourceBackfillPageResult<SoulResourceBackfillPageItem>

    cursor = page.cursor
    isDone = page.isDone

    for (const item of page.items) {
      totals.soulsScanned++
      if (item.hasResource && item.hasOwnerHandle) continue
      totals.soulsUpdated++
      if (dryRun) continue

      const result = await ctx.runMutation(internal.maintenance.upsertSoulResourceInternal, {
        soulId: item.soulId,
      })
      if (result.inserted) totals.resourcesInserted++
    }

    if (isDone) break
  }

  if (!isDone) {
    throw new ConvexError('Soul resource backfill incomplete (maxBatches reached)')
  }

  return { ok: true as const, stats: totals }
}

export const backfillResourcesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillResourcesInternalHandler,
})

export const backfillResources: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ResourceBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runAction(
      internal.maintenance.backfillResourcesInternal,
      args,
    ) as Promise<ResourceBackfillActionResult>
  },
})

export const scheduleBackfillResources: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillResourcesInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    })
    return { ok: true as const }
  },
})

type LegacyBadgeBackfillPageResult = {
  items: Doc<'skillBadges'>[]
  cursor: string | null
  isDone: boolean
}

export const getLegacySkillBadgePageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<LegacyBadgeBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skillBadges')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })
    return { items: page, cursor: continueCursor, isDone }
  },
})

export const getSkillResourceIdInternal = internalQuery({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId)
    return { resourceId: skill?.resourceId ?? null }
  },
})

export const getResourceBadgeByKindInternal = internalQuery({
  args: { resourceId: v.id('resources'), kind: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query('resourceBadges')
      .withIndex('by_resource_kind', (q) =>
        q.eq('resourceId', args.resourceId).eq('kind', args.kind as BadgeKind),
      )
      .unique()
  },
})

export const insertResourceBadgeInternal = internalMutation({
  args: {
    resourceId: v.id('resources'),
    kind: v.union(
      v.literal('highlighted'),
      v.literal('official'),
      v.literal('deprecated'),
      v.literal('redactionApproved'),
    ),
    byUserId: v.id('users'),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('resourceBadges', {
      resourceId: args.resourceId,
      kind: args.kind,
      byUserId: args.byUserId,
      at: args.at,
    })
    return { ok: true as const }
  },
})

export const backfillResourceBadgesFromLegacyInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: true; stats: ResourceBadgeBackfillStats }> => {
    const dryRun = Boolean(args.dryRun)
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)

    const totals: ResourceBadgeBackfillStats = {
      badgesScanned: 0,
      badgesInserted: 0,
      badgesSkipped: 0,
    }

    let cursor: string | null = null
    let isDone = false

    for (let i = 0; i < maxBatches; i++) {
      const page = (await ctx.runQuery(internal.maintenance.getLegacySkillBadgePageInternal, {
        cursor: cursor ?? undefined,
        batchSize,
      })) as LegacyBadgeBackfillPageResult

      cursor = page.cursor
      isDone = page.isDone

      for (const badge of page.items) {
        totals.badgesScanned++
        const skillResult = (await ctx.runQuery(internal.maintenance.getSkillResourceIdInternal, {
          skillId: badge.skillId,
        })) as { resourceId: Id<'resources'> | null }
        if (!skillResult.resourceId) {
          totals.badgesSkipped++
          continue
        }
        const existing = await ctx.runQuery(internal.maintenance.getResourceBadgeByKindInternal, {
          resourceId: skillResult.resourceId,
          kind: badge.kind,
        })
        if (existing) {
          totals.badgesSkipped++
          continue
        }
        if (dryRun) continue
        await ctx.runMutation(internal.maintenance.insertResourceBadgeInternal, {
          resourceId: skillResult.resourceId,
          kind: badge.kind,
          byUserId: badge.byUserId,
          at: badge.at,
        })
        totals.badgesInserted++
      }

      if (isDone) break
    }

    if (!isDone) {
      throw new ConvexError('Resource badge backfill incomplete (maxBatches reached)')
    }

    return { ok: true as const, stats: totals }
  },
})

export const backfillResourceBadges: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: true; stats: ResourceBadgeBackfillStats }> => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runAction(
      internal.maintenance.backfillResourceBadgesFromLegacyInternal,
      args,
    ) as Promise<{ ok: true; stats: ResourceBadgeBackfillStats }>
  },
})

export const scheduleBackfillResourceBadges: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillResourceBadgesFromLegacyInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    })
    return { ok: true as const }
  },
})

function clampInt(value: number, min: number, max: number) {
  const rounded = Math.trunc(value)
  if (!Number.isFinite(rounded)) return min
  return Math.min(max, Math.max(min, rounded))
}
