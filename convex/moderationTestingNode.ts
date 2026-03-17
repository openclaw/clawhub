'use node'

import { v } from 'convex/values'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction } from './functions'
import {
  buildTargetSlug,
  DEFAULT_ADMIN_PREFIX,
  DEFAULT_REGISTRY_BASE_URL,
  DEFAULT_USER_PREFIX,
  normalizeBaseUrl,
  normalizePrefix,
  resolveCorpusCases,
} from './lib/moderationTestingCorpus'
import {
  buildMaliciousTargetSlug,
  DEFAULT_MALICIOUS_ADMIN_PREFIX,
  DEFAULT_MALICIOUS_USER_PREFIX,
  normalizeMaliciousPrefix,
  resolveMaliciousCorpusCases,
} from './lib/moderationTestingMaliciousCorpus'
import { publishVersionForUser } from './lib/skillPublish'

const userRoleValidator = v.union(
  v.literal('admin'),
  v.literal('moderator'),
  v.literal('user'),
)

type RegistrySkillResponse = {
  skill: {
    slug: string
    displayName: string
  }
  latestVersion?: {
    version?: string
    changelog?: string | null
  } | null
  moderation?: Record<string, unknown> | null
}

type RegistryVersionResponse = {
  skill: {
    slug: string
    displayName: string
  }
  version: {
    version: string
    changelog?: string | null
    files: Array<{
      path: string
      size: number
      sha256: string
      contentType?: string | null
    }>
  }
}

type ImportedTestingFile = {
  path: string
  contentType?: string | null
  bytes: Uint8Array
}

async function sha256Hex(bytes: Uint8Array) {
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256')
  hash.update(bytes)
  return hash.digest('hex')
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'clawhub-moderation-testing',
    },
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }
  return (await response.json()) as T
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/plain',
      'User-Agent': 'clawhub-moderation-testing',
    },
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }
  return response.text()
}

async function resolveTargetOwnerUserId(
  ctx: Parameters<typeof publishVersionForUser>[0],
  params: {
    ownerHandle: string
    ownerDisplayName?: string
    ownerRole: 'admin' | 'moderator' | 'user'
    trustedPublisher?: boolean
  },
) {
  const ensured = (await ctx.runMutation(internal.moderationTesting.ensureCorpusUserInternal, {
    handle: params.ownerHandle,
    displayName: params.ownerDisplayName,
    role: params.ownerRole,
    trustedPublisher: params.trustedPublisher,
  })) as {
    userId: Id<'users'>
  }
  return ensured.userId
}

async function publishTestingBundle(
  ctx: Parameters<typeof publishVersionForUser>[0],
  params: {
    ownerUserId: Id<'users'>
    targetSlug: string
    displayName: string
    version: string
    changelog: string
    files: ImportedTestingFile[]
  },
) {
  const storedFiles: Array<{
    path: string
    size: number
    storageId: Id<'_storage'>
    sha256: string
    contentType?: string
  }> = []

  for (const file of params.files) {
    const storageId = await ctx.storage.store(
      new Blob([Buffer.from(file.bytes)], {
        type: file.contentType ?? 'text/plain; charset=utf-8',
      }),
    )
    storedFiles.push({
      path: file.path,
      size: file.bytes.byteLength,
      storageId,
      sha256: await sha256Hex(file.bytes),
      contentType: file.contentType ?? 'text/plain; charset=utf-8',
    })
  }

  return publishVersionForUser(
    ctx,
    params.ownerUserId,
    {
      slug: params.targetSlug,
      displayName: params.displayName,
      version: params.version,
      changelog: params.changelog,
      files: storedFiles,
    },
    {
      bypassGitHubAccountAge: true,
      bypassNewSkillRateLimit: true,
      bypassQualityGate: true,
      skipBackup: true,
      skipWebhook: true,
    },
  )
}

export const importPublicSkillFromRegistry: ReturnType<typeof internalAction> = internalAction({
  args: {
    sourceSlug: v.string(),
    sourceVersion: v.optional(v.string()),
    targetSlug: v.optional(v.string()),
    ownerHandle: v.string(),
    ownerDisplayName: v.optional(v.string()),
    ownerRole: userRoleValidator,
    trustedPublisher: v.optional(v.boolean()),
    sourceBaseUrl: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: 'imported' | 'already_exists'
    sourceSlug: string
    sourceVersion: string
    targetSlug: string
    ownerUserId?: Id<'users'>
    skillId: Id<'skills'> | null
    versionId: Id<'skillVersions'> | null
    sourceModeration?: Record<string, unknown> | null
  }> => {
    const baseUrl = normalizeBaseUrl(args.sourceBaseUrl)
    const sourceSlug = args.sourceSlug.trim().toLowerCase()
    const detail = await fetchJson<RegistrySkillResponse>(`${baseUrl}/api/v1/skills/${sourceSlug}`)
    const sourceVersion = args.sourceVersion?.trim() || detail.latestVersion?.version?.trim()
    if (!sourceVersion) {
      throw new Error(`Could not resolve source version for ${sourceSlug}`)
    }

    const targetSlug = (args.targetSlug?.trim().toLowerCase() || sourceSlug).trim()
    const existingSkill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
      slug: targetSlug,
    })) as Doc<'skills'> | null
    const existingVersion: Doc<'skillVersions'> | null = existingSkill
      ? ((await ctx.runQuery(api.skills.getVersionBySkillAndVersion, {
          skillId: existingSkill._id,
          version: sourceVersion,
        })) as Doc<'skillVersions'> | null)
      : null

    if (existingVersion?.version === sourceVersion) {
      return {
        status: 'already_exists' as const,
        sourceSlug,
        sourceVersion,
        targetSlug,
        skillId: existingSkill?._id ?? null,
        versionId: existingVersion?._id ?? null,
      }
    }

    const ownerUserId = await resolveTargetOwnerUserId(ctx, {
      ownerHandle: args.ownerHandle,
      ownerDisplayName: args.ownerDisplayName,
      ownerRole: args.ownerRole,
      trustedPublisher: args.trustedPublisher,
    })

    const versionMeta = await fetchJson<RegistryVersionResponse>(
      `${baseUrl}/api/v1/skills/${sourceSlug}/versions/${encodeURIComponent(sourceVersion)}`,
    )

    const files: ImportedTestingFile[] = []

    for (const file of versionMeta.version.files) {
      const fileUrl =
        `${baseUrl}/api/v1/skills/${sourceSlug}/file?` +
        new URLSearchParams({
          path: file.path,
          version: sourceVersion,
        }).toString()
      const content = await fetchText(fileUrl)
      const bytes = new TextEncoder().encode(content)
      files.push({
        path: file.path,
        contentType: file.contentType ?? 'text/plain; charset=utf-8',
        bytes,
      })
    }

    const publishResult = await publishTestingBundle(
      ctx,
      {
        ownerUserId,
        targetSlug,
        displayName: versionMeta.skill.displayName,
        version: versionMeta.version.version,
        changelog:
          versionMeta.version.changelog?.trim() || 'Imported for moderation testing',
        files,
      },
    )

    return {
      status: 'imported' as const,
      sourceSlug,
      sourceVersion,
      targetSlug,
      ownerUserId,
      skillId: publishResult.skillId,
      versionId: publishResult.versionId,
      sourceModeration: detail.moderation ?? null,
    }
  },
})

export const importSkillBundleForTesting: ReturnType<typeof internalAction> = internalAction({
  args: {
    sourceSlug: v.string(),
    sourceVersion: v.string(),
    sourceDisplayName: v.string(),
    sourceChangelog: v.optional(v.string()),
    targetSlug: v.optional(v.string()),
    ownerHandle: v.string(),
    ownerDisplayName: v.optional(v.string()),
    ownerRole: userRoleValidator,
    trustedPublisher: v.optional(v.boolean()),
    files: v.array(
      v.object({
        path: v.string(),
        contentType: v.optional(v.string()),
        base64: v.string(),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: 'imported' | 'already_exists'
    sourceSlug: string
    sourceVersion: string
    targetSlug: string
    ownerUserId?: Id<'users'>
    skillId: Id<'skills'> | null
    versionId: Id<'skillVersions'> | null
  }> => {
    const sourceSlug = args.sourceSlug.trim().toLowerCase()
    const sourceVersion = args.sourceVersion.trim()
    if (!sourceSlug || !sourceVersion) {
      throw new Error('sourceSlug and sourceVersion are required')
    }

    const targetSlug = (args.targetSlug?.trim().toLowerCase() || sourceSlug).trim()
    const existingSkill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
      slug: targetSlug,
    })) as Doc<'skills'> | null
    const existingVersion: Doc<'skillVersions'> | null = existingSkill
      ? ((await ctx.runQuery(api.skills.getVersionBySkillAndVersion, {
          skillId: existingSkill._id,
          version: sourceVersion,
        })) as Doc<'skillVersions'> | null)
      : null

    if (existingVersion?.version === sourceVersion) {
      return {
        status: 'already_exists',
        sourceSlug,
        sourceVersion,
        targetSlug,
        skillId: existingSkill?._id ?? null,
        versionId: existingVersion?._id ?? null,
      }
    }

    const ownerUserId = await resolveTargetOwnerUserId(ctx, {
      ownerHandle: args.ownerHandle,
      ownerDisplayName: args.ownerDisplayName,
      ownerRole: args.ownerRole,
      trustedPublisher: args.trustedPublisher,
    })

    const files: ImportedTestingFile[] = args.files.map((file) => ({
      path: file.path,
      contentType: file.contentType ?? 'text/plain; charset=utf-8',
      bytes: Buffer.from(file.base64, 'base64'),
    }))

    const publishResult = await publishTestingBundle(ctx, {
      ownerUserId,
      targetSlug,
      displayName: args.sourceDisplayName.trim(),
      version: sourceVersion,
      changelog: args.sourceChangelog?.trim() || 'Imported from archived bundle for moderation testing',
      files,
    })

    return {
      status: 'imported',
      sourceSlug,
      sourceVersion,
      targetSlug,
      ownerUserId,
      skillId: publishResult.skillId,
      versionId: publishResult.versionId,
    }
  },
})

export const importFalsePositiveCorpusFromRegistry = internalAction({
  args: {
    caseIds: v.optional(v.array(v.string())),
    includeAdminVariants: v.optional(v.boolean()),
    sourceBaseUrl: v.optional(v.string()),
    userPrefix: v.optional(v.string()),
    adminPrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cases = resolveCorpusCases(args.caseIds)
    const baseUrl = args.sourceBaseUrl?.trim() || DEFAULT_REGISTRY_BASE_URL
    const userPrefix = normalizePrefix(args.userPrefix, DEFAULT_USER_PREFIX)
    const adminPrefix = normalizePrefix(args.adminPrefix, DEFAULT_ADMIN_PREFIX)
    const includeAdminVariants = args.includeAdminVariants ?? true

    const results: Array<{
      caseId: string
      variant: 'user' | 'admin'
      sourceSlug: string
      targetSlug: string
      status: 'imported' | 'already_exists' | 'error'
      detail?: string
      skillId?: Id<'skills'> | null
      versionId?: Id<'skillVersions'> | null
    }> = []

    for (const entry of cases) {
      const variants: Array<{
        variant: 'user' | 'admin'
        ownerHandle: string
        ownerDisplayName: string
        ownerRole: 'admin' | 'moderator' | 'user'
        trustedPublisher?: boolean
        targetSlug: string
      }> = [
        {
          variant: 'user',
          ownerHandle: 'moderation-fp-user',
          ownerDisplayName: 'Moderation FP User',
          ownerRole: 'user',
          targetSlug: buildTargetSlug(userPrefix, entry.sourceSlug),
        },
      ]
      if (includeAdminVariants) {
        variants.push({
          variant: 'admin',
          ownerHandle: 'moderation-fp-admin',
          ownerDisplayName: 'Moderation FP Admin',
          ownerRole: 'admin',
          trustedPublisher: true,
          targetSlug: buildTargetSlug(adminPrefix, entry.sourceSlug),
        })
      }

      for (const variant of variants) {
        try {
          const result = (await ctx.runAction(
            internal.moderationTestingNode.importPublicSkillFromRegistry,
            {
              sourceSlug: entry.sourceSlug,
              targetSlug: variant.targetSlug,
              ownerHandle: variant.ownerHandle,
              ownerDisplayName: variant.ownerDisplayName,
              ownerRole: variant.ownerRole,
              trustedPublisher: variant.trustedPublisher,
              sourceBaseUrl: baseUrl,
            },
          )) as {
            status: 'imported' | 'already_exists'
            skillId: Id<'skills'> | null
            versionId: Id<'skillVersions'> | null
          }

          results.push({
            caseId: entry.caseId,
            variant: variant.variant,
            sourceSlug: entry.sourceSlug,
            targetSlug: variant.targetSlug,
            status: result.status,
            skillId: result.skillId,
            versionId: result.versionId,
          })
        } catch (error) {
          results.push({
            caseId: entry.caseId,
            variant: variant.variant,
            sourceSlug: entry.sourceSlug,
            targetSlug: variant.targetSlug,
            status: 'error',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    return {
      totalCases: cases.length,
      imported: results.filter((entry) => entry.status === 'imported').length,
      existing: results.filter((entry) => entry.status === 'already_exists').length,
      errors: results.filter((entry) => entry.status === 'error').length,
      results,
    }
  },
})

export const importMaliciousCorpusFromBundles = internalAction({
  args: {
    entries: v.array(
      v.object({
        caseId: v.string(),
        sourceSlug: v.string(),
        sourceVersion: v.string(),
        sourceDisplayName: v.string(),
        sourceChangelog: v.optional(v.string()),
        files: v.array(
          v.object({
            path: v.string(),
            contentType: v.optional(v.string()),
            base64: v.string(),
          }),
        ),
      }),
    ),
    includeAdminVariants: v.optional(v.boolean()),
    userPrefix: v.optional(v.string()),
    adminPrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const requestedCases = new Set(args.entries.map((entry) => entry.caseId.trim()).filter(Boolean))
    const corpusCases = resolveMaliciousCorpusCases(
      requestedCases.size > 0 ? Array.from(requestedCases) : undefined,
    )
    const casesById = new Map(corpusCases.map((entry) => [entry.caseId, entry]))
    const includeAdminVariants = args.includeAdminVariants ?? true
    const userPrefix = normalizeMaliciousPrefix(
      args.userPrefix,
      DEFAULT_MALICIOUS_USER_PREFIX,
    )
    const adminPrefix = normalizeMaliciousPrefix(
      args.adminPrefix,
      DEFAULT_MALICIOUS_ADMIN_PREFIX,
    )

    const results: Array<{
      caseId: string
      variant: 'user' | 'admin'
      sourceSlug: string
      targetSlug: string
      status: 'imported' | 'already_exists' | 'error'
      detail?: string
      skillId?: Id<'skills'> | null
      versionId?: Id<'skillVersions'> | null
    }> = []

    for (const entry of args.entries) {
      const corpusEntry = casesById.get(entry.caseId.trim())
      if (!corpusEntry) {
        results.push({
          caseId: entry.caseId,
          variant: 'user',
          sourceSlug: entry.sourceSlug,
          targetSlug: entry.sourceSlug,
          status: 'error',
          detail: `Unknown malicious corpus case: ${entry.caseId}`,
        })
        continue
      }

      const variants: Array<{
        variant: 'user' | 'admin'
        ownerHandle: string
        ownerDisplayName: string
        ownerRole: 'admin' | 'moderator' | 'user'
        trustedPublisher?: boolean
        targetSlug: string
      }> = [
        {
          variant: 'user',
          ownerHandle: 'moderation-mal-user',
          ownerDisplayName: 'Moderation Malicious User',
          ownerRole: 'user',
          targetSlug: buildMaliciousTargetSlug(userPrefix, corpusEntry.sourceSlug),
        },
      ]
      if (includeAdminVariants) {
        variants.push({
          variant: 'admin',
          ownerHandle: 'moderation-mal-admin',
          ownerDisplayName: 'Moderation Malicious Admin',
          ownerRole: 'admin',
          trustedPublisher: true,
          targetSlug: buildMaliciousTargetSlug(adminPrefix, corpusEntry.sourceSlug),
        })
      }

      for (const variant of variants) {
        try {
          const result = (await ctx.runAction(
            internal.moderationTestingNode.importSkillBundleForTesting,
            {
              sourceSlug: entry.sourceSlug,
              sourceVersion: entry.sourceVersion,
              sourceDisplayName: entry.sourceDisplayName,
              sourceChangelog: entry.sourceChangelog,
              targetSlug: variant.targetSlug,
              ownerHandle: variant.ownerHandle,
              ownerDisplayName: variant.ownerDisplayName,
              ownerRole: variant.ownerRole,
              trustedPublisher: variant.trustedPublisher,
              files: entry.files,
            },
          )) as {
            status: 'imported' | 'already_exists'
            skillId: Id<'skills'> | null
            versionId: Id<'skillVersions'> | null
          }

          results.push({
            caseId: corpusEntry.caseId,
            variant: variant.variant,
            sourceSlug: corpusEntry.sourceSlug,
            targetSlug: variant.targetSlug,
            status: result.status,
            skillId: result.skillId,
            versionId: result.versionId,
          })
        } catch (error) {
          results.push({
            caseId: corpusEntry.caseId,
            variant: variant.variant,
            sourceSlug: corpusEntry.sourceSlug,
            targetSlug: variant.targetSlug,
            status: 'error',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    return {
      totalCases: args.entries.length,
      imported: results.filter((entry) => entry.status === 'imported').length,
      existing: results.filter((entry) => entry.status === 'already_exists').length,
      errors: results.filter((entry) => entry.status === 'error').length,
      results,
    }
  },
})

export const triggerRealScansForSlug = internalAction({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const skill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
      slug: args.slug.trim().toLowerCase(),
    })) as Doc<'skills'> | null
    if (!skill?.latestVersionId) {
      return { ok: false as const, error: 'Skill not found or has no published version' }
    }

    await ctx.runAction(internal.vt.scanWithVirusTotal, {
      versionId: skill.latestVersionId,
    })
    await ctx.runAction(internal.llmEval.evaluateWithLlm, {
      versionId: skill.latestVersionId,
    })

    return { ok: true as const, skillId: skill._id, versionId: skill.latestVersionId }
  },
})

export const triggerFalsePositiveCorpusScans = internalAction({
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

    const slugs = new Set<string>()
    for (const entry of cases) {
      slugs.add(buildTargetSlug(userPrefix, entry.sourceSlug))
      if (includeAdminVariants) {
        slugs.add(buildTargetSlug(adminPrefix, entry.sourceSlug))
      }
    }

    const results: Array<{ slug: string; ok: boolean; error?: string }> = []
    for (const slug of slugs) {
      const result = (await ctx.runAction(internal.moderationTestingNode.triggerRealScansForSlug, {
        slug,
      })) as { ok: boolean; error?: string }
      results.push({ slug, ok: result.ok, error: result.error })
    }

    return {
      total: results.length,
      ok: results.filter((entry) => entry.ok).length,
      errors: results.filter((entry) => !entry.ok).length,
      results,
    }
  },
})

export const triggerMaliciousCorpusScans = internalAction({
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

    const slugs = new Set<string>()
    for (const entry of cases) {
      slugs.add(buildMaliciousTargetSlug(userPrefix, entry.sourceSlug))
      if (includeAdminVariants) {
        slugs.add(buildMaliciousTargetSlug(adminPrefix, entry.sourceSlug))
      }
    }

    const results: Array<{ slug: string; ok: boolean; error?: string }> = []
    for (const slug of slugs) {
      const result = (await ctx.runAction(internal.moderationTestingNode.triggerRealScansForSlug, {
        slug,
      })) as { ok: boolean; error?: string }
      results.push({ slug, ok: result.ok, error: result.error })
    }

    return {
      total: results.length,
      ok: results.filter((entry) => entry.ok).length,
      errors: results.filter((entry) => !entry.ok).length,
      results,
    }
  },
})
