import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internalMutation, internalQuery } from './functions'
import {
  buildTargetSlug,
  DEFAULT_ADMIN_PREFIX,
  DEFAULT_USER_PREFIX,
  FALSE_POSITIVE_CORPUS,
  normalizePrefix,
  resolveCorpusCases,
  type FalsePositiveCase,
} from './lib/moderationTestingCorpus'
import {
  buildMaliciousTargetSlug,
  DEFAULT_MALICIOUS_ADMIN_PREFIX,
  DEFAULT_MALICIOUS_USER_PREFIX,
  MALICIOUS_CORPUS,
  normalizeMaliciousPrefix,
  resolveMaliciousCorpusCases,
  type MaliciousCorpusCase,
} from './lib/moderationTestingMaliciousCorpus'

const userRoleValidator = v.union(
  v.literal('admin'),
  v.literal('moderator'),
  v.literal('user'),
)

type ImportedSkillReport = {
  caseId: string
  bucket: FalsePositiveCase['bucket']
  issueNumber: number
  sourceSlug: string
  targetSlug: string
  ownerHandle: string
  ownerRole: 'admin' | 'moderator' | 'user'
  notes: string
  exists: boolean
  version: string | null
  sourceVersionId: string | null
  moderationStatus: Doc<'skills'>['moderationStatus'] | null
  moderationReason: Doc<'skills'>['moderationReason'] | null
  moderationVerdict: Doc<'skills'>['moderationVerdict'] | null
  moderationReasonCodes: Doc<'skills'>['moderationReasonCodes'] | null
  moderationFlags: Doc<'skills'>['moderationFlags'] | null
  moderationSignals: Doc<'skills'>['moderationSignals'] | null
  isSuspicious: boolean | null
  staticScan: Doc<'skillVersions'>['staticScan'] | null
  vtAnalysis: Doc<'skillVersions'>['vtAnalysis'] | null
  llmAnalysis: Doc<'skillVersions'>['llmAnalysis'] | null
  versionSignals: Doc<'skillVersions'>['moderationSignals'] | null
}

type ImportedMaliciousSkillReport = {
  caseId: string
  bucket: MaliciousCorpusCase['bucket']
  sourceSlug: string
  targetSlug: string
  ownerHandle: string
  ownerRole: 'admin' | 'moderator' | 'user'
  notes: string
  exists: boolean
  version: string | null
  sourceVersionId: string | null
  moderationStatus: Doc<'skills'>['moderationStatus'] | null
  moderationReason: Doc<'skills'>['moderationReason'] | null
  moderationVerdict: Doc<'skills'>['moderationVerdict'] | null
  moderationReasonCodes: Doc<'skills'>['moderationReasonCodes'] | null
  moderationFlags: Doc<'skills'>['moderationFlags'] | null
  moderationSignals: Doc<'skills'>['moderationSignals'] | null
  isSuspicious: boolean | null
  staticScan: Doc<'skillVersions'>['staticScan'] | null
  vtAnalysis: Doc<'skillVersions'>['vtAnalysis'] | null
  llmAnalysis: Doc<'skillVersions'>['llmAnalysis'] | null
  versionSignals: Doc<'skillVersions'>['moderationSignals'] | null
}

export const ensureCorpusUserInternal = internalMutation({
  args: {
    handle: v.string(),
    displayName: v.optional(v.string()),
    role: userRoleValidator,
    trustedPublisher: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const handle = args.handle.trim().toLowerCase()
    if (!handle) throw new Error('handle is required')

    const displayName = args.displayName?.trim() || handle
    const now = Date.now()
    const existing = await ctx.db
      .query('users')
      .withIndex('handle', (q) => q.eq('handle', handle))
      .unique()

    if (existing) {
      const patch: Partial<Doc<'users'>> = {}
      if (existing.displayName !== displayName) patch.displayName = displayName
      if (existing.name !== handle) patch.name = handle
      if (existing.role !== args.role) patch.role = args.role
      if (existing.trustedPublisher !== args.trustedPublisher) {
        patch.trustedPublisher = args.trustedPublisher
      }
      if (existing.deletedAt !== undefined) patch.deletedAt = undefined
      if (existing.deactivatedAt !== undefined) patch.deactivatedAt = undefined
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = now
        await ctx.db.patch(existing._id, patch)
      }
      return { userId: existing._id, created: false as const }
    }

    const userId = await ctx.db.insert('users', {
      handle,
      name: handle,
      displayName,
      role: args.role,
      trustedPublisher: args.trustedPublisher,
      createdAt: now,
      updatedAt: now,
    })

    return { userId, created: true as const }
  },
})

export const getFalsePositiveCorpusMatrixInternal = internalQuery({
  args: {},
  handler: async () => FALSE_POSITIVE_CORPUS,
})

export const getMaliciousCorpusMatrixInternal = internalQuery({
  args: {},
  handler: async () => MALICIOUS_CORPUS,
})

export const getFalsePositiveCorpusReportInternal = internalQuery({
  args: {
    caseIds: v.optional(v.array(v.string())),
    includeAdminVariants: v.optional(v.boolean()),
    userPrefix: v.optional(v.string()),
    adminPrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cases = resolveCorpusCases(args.caseIds)
    const includeAdminVariants = args.includeAdminVariants ?? true
    const userPrefix = normalizePrefix(args.userPrefix, DEFAULT_USER_PREFIX)
    const adminPrefix = normalizePrefix(args.adminPrefix, DEFAULT_ADMIN_PREFIX)

    const reports: ImportedSkillReport[] = []

    for (const entry of cases) {
      const variants: Array<{
        targetSlug: string
        ownerHandle: string
        ownerRole: 'admin' | 'moderator' | 'user'
      }> = [
        {
          targetSlug: buildTargetSlug(userPrefix, entry.sourceSlug),
          ownerHandle: 'moderation-fp-user',
          ownerRole: 'user',
        },
      ]
      if (includeAdminVariants) {
        variants.push({
          targetSlug: buildTargetSlug(adminPrefix, entry.sourceSlug),
          ownerHandle: 'moderation-fp-admin',
          ownerRole: 'admin',
        })
      }

      for (const variant of variants) {
        const skill = await ctx.db
          .query('skills')
          .withIndex('by_slug', (q) => q.eq('slug', variant.targetSlug))
          .unique()
        const version = skill?.latestVersionId
          ? await ctx.db.get(skill.latestVersionId)
          : null

        reports.push({
          caseId: entry.caseId,
          bucket: entry.bucket,
          issueNumber: entry.issueNumber,
          sourceSlug: entry.sourceSlug,
          targetSlug: variant.targetSlug,
          ownerHandle: variant.ownerHandle,
          ownerRole: variant.ownerRole,
          notes: entry.notes,
          exists: Boolean(skill),
          version: version?.version ?? null,
          sourceVersionId: skill?.moderationSourceVersionId ?? null,
          moderationStatus: skill?.moderationStatus ?? null,
          moderationReason: skill?.moderationReason ?? null,
          moderationVerdict: skill?.moderationVerdict ?? null,
          moderationReasonCodes: skill?.moderationReasonCodes ?? null,
          moderationFlags: skill?.moderationFlags ?? null,
          moderationSignals: skill?.moderationSignals ?? null,
          isSuspicious: skill?.isSuspicious ?? null,
          staticScan: version?.staticScan ?? null,
          vtAnalysis: version?.vtAnalysis ?? null,
          llmAnalysis: version?.llmAnalysis ?? null,
          versionSignals: version?.moderationSignals ?? null,
        })
      }
    }

    return reports
  },
})

export const getMaliciousCorpusReportInternal = internalQuery({
  args: {
    caseIds: v.optional(v.array(v.string())),
    includeAdminVariants: v.optional(v.boolean()),
    userPrefix: v.optional(v.string()),
    adminPrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cases = resolveMaliciousCorpusCases(args.caseIds)
    const includeAdminVariants = args.includeAdminVariants ?? true
    const userPrefix = normalizeMaliciousPrefix(
      args.userPrefix,
      DEFAULT_MALICIOUS_USER_PREFIX,
    )
    const adminPrefix = normalizeMaliciousPrefix(
      args.adminPrefix,
      DEFAULT_MALICIOUS_ADMIN_PREFIX,
    )

    const reports: ImportedMaliciousSkillReport[] = []

    for (const entry of cases) {
      const variants: Array<{
        targetSlug: string
        ownerHandle: string
        ownerRole: 'admin' | 'moderator' | 'user'
      }> = [
        {
          targetSlug: buildMaliciousTargetSlug(userPrefix, entry.sourceSlug),
          ownerHandle: 'moderation-mal-user',
          ownerRole: 'user',
        },
      ]
      if (includeAdminVariants) {
        variants.push({
          targetSlug: buildMaliciousTargetSlug(adminPrefix, entry.sourceSlug),
          ownerHandle: 'moderation-mal-admin',
          ownerRole: 'admin',
        })
      }

      for (const variant of variants) {
        const skill = await ctx.db
          .query('skills')
          .withIndex('by_slug', (q) => q.eq('slug', variant.targetSlug))
          .unique()
        const version = skill?.latestVersionId
          ? await ctx.db.get(skill.latestVersionId)
          : null

        reports.push({
          caseId: entry.caseId,
          bucket: entry.bucket,
          sourceSlug: entry.sourceSlug,
          targetSlug: variant.targetSlug,
          ownerHandle: variant.ownerHandle,
          ownerRole: variant.ownerRole,
          notes: entry.notes,
          exists: Boolean(skill),
          version: version?.version ?? null,
          sourceVersionId: skill?.moderationSourceVersionId ?? null,
          moderationStatus: skill?.moderationStatus ?? null,
          moderationReason: skill?.moderationReason ?? null,
          moderationVerdict: skill?.moderationVerdict ?? null,
          moderationReasonCodes: skill?.moderationReasonCodes ?? null,
          moderationFlags: skill?.moderationFlags ?? null,
          moderationSignals: skill?.moderationSignals ?? null,
          isSuspicious: skill?.isSuspicious ?? null,
          staticScan: version?.staticScan ?? null,
          vtAnalysis: version?.vtAnalysis ?? null,
          llmAnalysis: version?.llmAnalysis ?? null,
          versionSignals: version?.moderationSignals ?? null,
        })
      }
    }

    return reports
  },
})
