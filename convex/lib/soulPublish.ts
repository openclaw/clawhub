import { ConvexError } from 'convex/values'
import semver from 'semver'
import { api, internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { generateEmbedding } from './embeddings'
import {
  buildEmbeddingText,
  getFrontmatterMetadata,
  getFrontmatterValue,
  hashSkillFiles,
  isTextFile,
  parseFrontmatter,
  sanitizePath,
} from './skills'
import { generateSoulChangelogForPublish } from './soulChangelog'

const MAX_TOTAL_BYTES = 50 * 1024 * 1024

const MAX_SUMMARY_LENGTH = 160

function deriveSoulSummary(readmeText: string) {
  const lines = readmeText.split(/\r?\n/)
  let inFrontmatter = false
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (!inFrontmatter && trimmed === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (trimmed === '---') {
        inFrontmatter = false
      }
      continue
    }
    const cleaned = trimmed.replace(/^#+\s*/, '')
    if (!cleaned) continue
    if (cleaned.length > MAX_SUMMARY_LENGTH) {
      return `${cleaned.slice(0, MAX_SUMMARY_LENGTH - 3).trimEnd()}...`
    }
    return cleaned
  }
  return undefined
}

export type PublishResult = {
  soulId: Id<'souls'>
  versionId: Id<'soulVersions'>
  embeddingId: Id<'soulEmbeddings'>
}

export type PublishVersionArgs = {
  slug: string
  displayName: string
  version: string
  changelog: string
  tags?: string[]
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

export async function publishSoulVersionForUser(
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
  const suppliedChangelog = args.changelog.trim()
  const changelogSource = suppliedChangelog ? ('user' as const) : ('auto' as const)

  const sanitizedFiles = args.files.map((file) => {
    const path = sanitizePath(file.path)
    if (!path) throw new ConvexError('Invalid file paths')
    if (!isTextFile(path, file.contentType ?? undefined)) {
      throw new ConvexError('Only text-based files are allowed')
    }
    return { ...file, path }
  })

  const totalBytes = sanitizedFiles.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new ConvexError('Soul bundle exceeds 50MB limit')
  }

  const isSoulFile = (path: string) => path.toLowerCase() === 'soul.md'
  const readmeFile = sanitizedFiles.find((file) => isSoulFile(file.path))
  if (!readmeFile) throw new ConvexError('SOUL.md is required')

  const nonSoulFiles = sanitizedFiles.filter((file) => !isSoulFile(file.path))
  if (nonSoulFiles.length > 0) {
    throw new ConvexError('Only SOUL.md is allowed for soul bundles')
  }

  const readmeText = await fetchText(ctx, readmeFile.storageId)
  const frontmatter = parseFrontmatter(readmeText)
  const summary = getFrontmatterValue(frontmatter, 'description') ?? deriveSoulSummary(readmeText)
  const metadata = mergeSourceIntoMetadata(getFrontmatterMetadata(frontmatter), args.source)

  const embeddingText = buildEmbeddingText({
    frontmatter,
    readme: readmeText,
    otherFiles: [],
  })

  const fingerprint = await hashSkillFiles(
    sanitizedFiles.map((file) => ({
      path: file.path ?? '',
      sha256: file.sha256,
    })),
  )

  const changelogPromise =
    changelogSource === 'user'
      ? Promise.resolve(suppliedChangelog)
      : generateSoulChangelogForPublish(ctx, {
          slug,
          version,
          readmeText,
          files: sanitizedFiles.map((file) => ({ path: file.path ?? '', sha256: file.sha256 })),
        })

  const embeddingPromise = generateEmbedding(embeddingText)

  const [changelogText, embedding] = await Promise.all([
    changelogPromise,
    embeddingPromise.catch((error) => {
      throw new ConvexError(formatEmbeddingError(error))
    }),
  ])

  const publishResult = (await ctx.runMutation(internal.souls.insertVersion, {
    userId,
    slug,
    displayName,
    version,
    changelog: changelogText,
    changelogSource,
    tags: args.tags?.map((tag) => tag.trim()).filter(Boolean),
    fingerprint,
    files: sanitizedFiles,
    parsed: {
      frontmatter,
      metadata,
    },
    summary,
    embedding,
  })) as PublishResult

  const owner = (await ctx.runQuery(api.users.getById, { userId })) as Doc<'users'> | null
  const ownerHandle = owner?.handle ?? owner?.name ?? userId

  void ctx.scheduler
    .runAfter(0, internal.githubSoulBackupsNode.backupSoulForPublishInternal, {
      slug,
      version,
      displayName,
      ownerHandle,
      files: sanitizedFiles,
      publishedAt: Date.now(),
    })
    .catch((error) => {
      console.error('GitHub soul backup scheduling failed', error)
    })

  return publishResult
}

function mergeSourceIntoMetadata(metadata: unknown, source: PublishVersionArgs['source']) {
  if (!source) return metadata === undefined ? undefined : metadata
  const sourceValue = {
    kind: source.kind,
    url: source.url,
    repo: source.repo,
    ref: source.ref,
    commit: source.commit,
    path: source.path,
    importedAt: source.importedAt,
  }

  if (!metadata) return { source: sourceValue }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return { source: sourceValue }
  return { ...(metadata as Record<string, unknown>), source: sourceValue }
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

export const __test = {
  getSummary: (frontmatter: Record<string, unknown>) =>
    getFrontmatterValue(frontmatter, 'description'),
}
