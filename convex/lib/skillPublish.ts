import { ConvexError } from 'convex/values'
import semver from 'semver'
import { api, internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx, MutationCtx } from '../_generated/server'
import { getSkillBadgeMap, isSkillHighlighted } from './badges'
import { generateChangelogForPublish } from './changelog'
import { generateEmbedding } from './embeddings'
import { requireGitHubAccountAge } from './githubAccount'
import type { PublicUser } from './public'
import {
  computeQualitySignals,
  evaluateQuality,
  getTrustTier,
  type QualityAssessment,
  toStructuralFingerprint,
} from './skillQuality'
import { generateSkillSummary } from './skillSummary'
import {
  buildEmbeddingText,
  getFrontmatterMetadata,
  getFrontmatterValue,
  hashSkillFiles,
  isTextFile,
  parseClawdisMetadata,
  parseFrontmatter,
  sanitizePath,
} from './skills'
import type { WebhookSkillPayload } from './webhooks'

const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const MAX_FILES_FOR_EMBEDDING = 40
const QUALITY_WINDOW_MS = 24 * 60 * 60 * 1000
const QUALITY_ACTIVITY_LIMIT = 60

export type PublishResult = {
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'>
  embeddingId: Id<'skillEmbeddings'>
}

export type PublishVersionArgs = {
  slug: string
  displayName: string
  version: string
  changelog: string
  tags?: string[]
  forkOf?: { slug: string; version?: string }
  source?: {
    kind: 'github'
    url: string
    repo: string
    ref: string
    commit: string
    path: string
    importedAt: number
  }
  files: Array<{
    path: string
    size: number
    storageId: Id<'_storage'>
    sha256: string
    contentType?: string
  }>
}

export async function publishVersionForUser(
  ctx: ActionCtx,
  userId: Id<'users'>,
  args: PublishVersionArgs,
): Promise<PublishResult> {
  const version = args.version.trim()
  const slug = args.slug.trim().toLowerCase()
  const displayName = args.displayName.trim()
  if (!slug || !displayName) throw new ConvexError('Slug and display name required')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new ConvexError('Slug must be lowercase and url-safe')
  }
  if (!semver.valid(version)) {
    throw new ConvexError('Version must be valid semver')
  }

  await requireGitHubAccountAge(ctx, userId)
  const existingSkill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
    slug,
  })) as Doc<'skills'> | null
  const isNewSkill = !existingSkill

  const suppliedChangelog = args.changelog.trim()
  const changelogSource = suppliedChangelog ? ('user' as const) : ('auto' as const)

  const sanitizedFiles = args.files.map((file) => ({
    ...file,
    path: sanitizePath(file.path),
  }))
  if (sanitizedFiles.some((file) => !file.path)) {
    throw new ConvexError('Invalid file paths')
  }
  const safeFiles = sanitizedFiles.map((file) => ({
    ...file,
    path: file.path as string,
  }))
  if (safeFiles.some((file) => !isTextFile(file.path, file.contentType ?? undefined))) {
    throw new ConvexError('Only text-based files are allowed')
  }

  const totalBytes = safeFiles.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new ConvexError('Skill bundle exceeds 50MB limit')
  }

  const readmeFile = safeFiles.find(
    (file) => file.path?.toLowerCase() === 'skill.md' || file.path?.toLowerCase() === 'skills.md',
  )
  if (!readmeFile) throw new ConvexError('SKILL.md is required')

  const readmeText = await fetchText(ctx, readmeFile.storageId)
  const frontmatter = parseFrontmatter(readmeText)
  const clawdis = parseClawdisMetadata(frontmatter)
  const owner = (await ctx.runQuery(internal.users.getByIdInternal, {
    userId,
  })) as Doc<'users'> | null
  const ownerCreatedAt = owner?.createdAt ?? owner?._creationTime ?? Date.now()
  const now = Date.now()
  const frontmatterMetadata = getFrontmatterMetadata(frontmatter)
  // Check for description in metadata.description (nested) or description (direct frontmatter field)
  const metadataDescription =
    frontmatterMetadata &&
    typeof frontmatterMetadata === 'object' &&
    !Array.isArray(frontmatterMetadata) &&
    typeof (frontmatterMetadata as Record<string, unknown>).description === 'string'
      ? ((frontmatterMetadata as Record<string, unknown>).description as string)
      : undefined
  const directDescription = getFrontmatterValue(frontmatter, 'description')
  // Prioritize the new description from frontmatter over the existing skill summary
  // This ensures updates to the description are reflected on subsequent publishes (#301)
  const summaryFromFrontmatter = metadataDescription ?? directDescription
  const summary = await generateSkillSummary({
    slug,
    displayName,
    readmeText,
    currentSummary: summaryFromFrontmatter ?? existingSkill?.summary ?? undefined,
  })

  let qualityAssessment: QualityAssessment | null = null
  if (isNewSkill) {
    const ownerActivity = (await ctx.runQuery(internal.skills.getOwnerSkillActivityInternal, {
      ownerUserId: userId,
      limit: QUALITY_ACTIVITY_LIMIT,
    })) as Array<{
      slug: string
      summary?: string
      createdAt: number
      latestVersionId?: Id<'skillVersions'>
    }>

    const trustTier = getTrustTier(now - ownerCreatedAt, ownerActivity.length)
    const qualitySignals = computeQualitySignals({
      readmeText,
      summary,
    })
    const recentCandidates = ownerActivity.filter(
      (entry) =>
        entry.slug !== slug && entry.createdAt >= now - QUALITY_WINDOW_MS && entry.latestVersionId,
    )
    let similarRecentCount = 0
    for (const entry of recentCandidates) {
      const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId: entry.latestVersionId as Id<'skillVersions'>,
      })) as Doc<'skillVersions'> | null
      if (!version) continue
      const candidateReadmeFile = version.files.find((file) => {
        const lower = file.path.toLowerCase()
        return lower === 'skill.md' || lower === 'skills.md'
      })
      if (!candidateReadmeFile) continue
      const candidateText = await fetchText(ctx, candidateReadmeFile.storageId)
      if (toStructuralFingerprint(candidateText) === qualitySignals.structuralFingerprint) {
        similarRecentCount += 1
      }
    }

    qualityAssessment = evaluateQuality({
      signals: qualitySignals,
      trustTier,
      similarRecentCount,
    })
    if (qualityAssessment.decision === 'reject') {
      throw new ConvexError(qualityAssessment.reason)
    }
  }

  const metadata = mergeSourceIntoMetadata(frontmatterMetadata, args.source, qualityAssessment)

  const otherFiles = [] as Array<{ path: string; content: string }>
  for (const file of safeFiles) {
    if (!file.path || file.path.toLowerCase().endsWith('.md')) continue
    if (!isTextFile(file.path, file.contentType ?? undefined)) continue
    const content = await fetchText(ctx, file.storageId)
    otherFiles.push({ path: file.path, content })
    if (otherFiles.length >= MAX_FILES_FOR_EMBEDDING) break
  }

  const embeddingText = buildEmbeddingText({
    frontmatter,
    readme: readmeText,
    otherFiles,
  })

  const fingerprintPromise = hashSkillFiles(
    safeFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
  )

  const changelogPromise =
    changelogSource === 'user'
      ? Promise.resolve(suppliedChangelog)
      : generateChangelogForPublish(ctx, {
          slug,
          version,
          readmeText,
          files: safeFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
        })

  const embeddingPromise = generateEmbedding(embeddingText)

  const [fingerprint, changelogText, embedding] = await Promise.all([
    fingerprintPromise,
    changelogPromise,
    embeddingPromise.catch((error) => {
      throw new ConvexError(formatEmbeddingError(error))
    }),
  ])

  const publishResult = (await ctx.runMutation(internal.skills.insertVersion, {
    userId,
    slug,
    displayName,
    version,
    changelog: changelogText,
    changelogSource,
    tags: args.tags?.map((tag) => tag.trim()).filter(Boolean),
    fingerprint,
    forkOf: args.forkOf
      ? {
          slug: args.forkOf.slug.trim().toLowerCase(),
          version: args.forkOf.version?.trim() || undefined,
        }
      : undefined,
    files: safeFiles.map((file) => ({
      ...file,
      path: file.path,
    })),
    parsed: {
      frontmatter,
      metadata,
      clawdis,
    },
    summary,
    embedding,
    qualityAssessment: qualityAssessment
      ? {
          decision: qualityAssessment.decision,
          score: qualityAssessment.score,
          reason: qualityAssessment.reason,
          trustTier: qualityAssessment.trustTier,
          similarRecentCount: qualityAssessment.similarRecentCount,
          signals: qualityAssessment.signals,
        }
      : undefined,
  })) as PublishResult

  await ctx.scheduler.runAfter(0, internal.vt.scanWithVirusTotal, {
    versionId: publishResult.versionId,
  })

  await ctx.scheduler.runAfter(0, internal.llmEval.evaluateWithLlm, {
    versionId: publishResult.versionId,
  })

  const ownerHandle = owner?.handle ?? owner?.displayName ?? owner?.name ?? 'unknown'

  void ctx.scheduler
    .runAfter(0, internal.githubBackupsNode.backupSkillForPublishInternal, {
      slug,
      version,
      displayName,
      ownerHandle,
      files: safeFiles,
      publishedAt: Date.now(),
    })
    .catch((error) => {
      console.error('GitHub backup scheduling failed', error)
    })

  void schedulePublishWebhook(ctx, {
    slug,
    version,
    displayName,
  })

  return publishResult
}

function mergeSourceIntoMetadata(
  metadata: unknown,
  source: PublishVersionArgs['source'],
  qualityAssessment: QualityAssessment | null = null,
) {
  const base =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {}

  if (source) {
    base.source = {
      kind: source.kind,
      url: source.url,
      repo: source.repo,
      ref: source.ref,
      commit: source.commit,
      path: source.path,
      importedAt: source.importedAt,
    }
  }

  if (qualityAssessment) {
    base._clawhubQuality = {
      score: qualityAssessment.score,
      decision: qualityAssessment.decision,
      trustTier: qualityAssessment.trustTier,
      similarRecentCount: qualityAssessment.similarRecentCount,
      signals: qualityAssessment.signals,
      reason: qualityAssessment.reason,
      evaluatedAt: Date.now(),
    }
  }

  return Object.keys(base).length ? base : undefined
}

export const __test = {
  mergeSourceIntoMetadata,
  computeQualitySignals,
  evaluateQuality,
  toStructuralFingerprint,
}

export async function queueHighlightedWebhook(ctx: MutationCtx, skillId: Id<'skills'>) {
  const skill = await ctx.db.get(skillId)
  if (!skill) return
  const owner = await ctx.db.get(skill.ownerUserId)
  const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null

  const badges = await getSkillBadgeMap(ctx, skillId)
  const payload: WebhookSkillPayload = {
    slug: skill.slug,
    displayName: skill.displayName,
    summary: skill.summary ?? undefined,
    version: latestVersion?.version ?? undefined,
    ownerHandle: owner?.handle ?? owner?.name ?? undefined,
    highlighted: isSkillHighlighted({ badges }),
    tags: Object.keys(skill.tags ?? {}),
  }

  await ctx.scheduler.runAfter(0, internal.webhooks.sendDiscordWebhook, {
    event: 'skill.highlighted',
    skill: payload,
  })
}

export async function fetchText(
  ctx: { storage: { get: (id: Id<'_storage'>) => Promise<Blob | null> } },
  storageId: Id<'_storage'>,
) {
  const blob = await ctx.storage.get(storageId)
  if (!blob) throw new Error('File missing in storage')
  return blob.text()
}

function formatEmbeddingError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes('OPENAI_API_KEY')) {
      return 'OPENAI_API_KEY is not configured.'
    }
    if (error.message.startsWith('Embedding failed')) {
      return error.message
    }
  }
  return 'Embedding failed. Please try again.'
}

async function schedulePublishWebhook(
  ctx: ActionCtx,
  params: { slug: string; version: string; displayName: string },
) {
  const result = (await ctx.runQuery(api.skills.getBySlug, {
    slug: params.slug,
  })) as { skill: Doc<'skills'>; owner: PublicUser | null } | null
  if (!result?.skill) return

  const payload: WebhookSkillPayload = {
    slug: result.skill.slug,
    displayName: result.skill.displayName || params.displayName,
    summary: result.skill.summary ?? undefined,
    version: params.version,
    ownerHandle: result.owner?.handle ?? result.owner?.name ?? undefined,
    highlighted: isSkillHighlighted(result.skill),
    tags: Object.keys(result.skill.tags ?? {}),
  }

  await ctx.scheduler.runAfter(0, internal.webhooks.sendDiscordWebhook, {
    event: 'skill.publish',
    skill: payload,
  })
}
