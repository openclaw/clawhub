import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { extractResponseText } from './openaiResponse'

const CHANGELOG_MODEL = process.env.OPENAI_CHANGELOG_MODEL ?? 'gpt-4.1'
const MAX_README_CHARS = 8_000
const MAX_PATHS_IN_PROMPT = 30

type FileMeta = { path: string; sha256?: string }

type FileDiffSummary = {
  added: string[]
  removed: string[]
  changed: string[]
}

function clampText(value: string, maxChars: number) {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars).trimEnd()}\n…`
}

function summarizeFileDiff(oldFiles: FileMeta[], nextFiles: FileMeta[]): FileDiffSummary {
  const oldByPath = new Map(oldFiles.map((f) => [f.path, f] as const))
  const nextByPath = new Map(nextFiles.map((f) => [f.path, f] as const))

  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []

  for (const [path, file] of nextByPath.entries()) {
    const prev = oldByPath.get(path)
    if (!prev) {
      added.push(path)
      continue
    }
    if (file.sha256 && prev.sha256 && file.sha256 !== prev.sha256) changed.push(path)
  }
  for (const path of oldByPath.keys()) {
    if (!nextByPath.has(path)) removed.push(path)
  }

  added.sort()
  removed.sort()
  changed.sort()
  return { added, removed, changed }
}

function formatDiffSummary(diff: FileDiffSummary) {
  const parts: string[] = []
  if (diff.added.length) parts.push(`${diff.added.length} added`)
  if (diff.changed.length) parts.push(`${diff.changed.length} changed`)
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`)
  return parts.join(', ') || 'no file changes detected'
}

function pickPaths(values: string[]) {
  if (values.length <= MAX_PATHS_IN_PROMPT) return values
  return values.slice(0, MAX_PATHS_IN_PROMPT)
}

async function generateWithOpenAI(args: {
  slug: string
  version: string
  oldReadme: string | null
  nextReadme: string
  fileDiff: FileDiffSummary | null
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const oldReadme = args.oldReadme ? clampText(args.oldReadme, MAX_README_CHARS) : ''
  const nextReadme = clampText(args.nextReadme, MAX_README_CHARS)

  const fileDiff = args.fileDiff
  const diffSummary = fileDiff ? formatDiffSummary(fileDiff) : 'unknown'
  const changedPaths = fileDiff ? pickPaths(fileDiff.changed) : []
  const addedPaths = fileDiff ? pickPaths(fileDiff.added) : []
  const removedPaths = fileDiff ? pickPaths(fileDiff.removed) : []

  const input = [
    `Soul: ${args.slug}`,
    `Version: ${args.version}`,
    `File changes: ${diffSummary}`,
    changedPaths.length ? `Changed files (sample): ${changedPaths.join(', ')}` : null,
    addedPaths.length ? `Added files (sample): ${addedPaths.join(', ')}` : null,
    removedPaths.length ? `Removed files (sample): ${removedPaths.join(', ')}` : null,
    oldReadme ? `Previous SOUL.md:\n${oldReadme}` : null,
    `New SOUL.md:\n${nextReadme}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CHANGELOG_MODEL,
      instructions:
        'Write a concise changelog for this soul version. Audience: everyone. Output plain text. Prefer 2–6 bullet points. If it is a big change, include a short 1-line summary first, then bullets. Don’t mention that you are AI. Don’t invent details; only use the inputs.',
      input,
      max_output_tokens: 220,
    }),
  })

  if (!response.ok) return null
  const payload = (await response.json()) as unknown
  return extractResponseText(payload)
}

function generateFallback(args: {
  slug: string
  version: string
  oldReadme: string | null
  nextReadme: string
  fileDiff: FileDiffSummary | null
}) {
  const lines: string[] = []
  if (!args.oldReadme) {
    lines.push(`- Initial release.`)
    return lines.join('\n')
  }

  const diff = args.fileDiff
  if (diff) {
    const parts: string[] = []
    if (diff.added.length) parts.push(`added ${diff.added.length}`)
    if (diff.changed.length) parts.push(`updated ${diff.changed.length}`)
    if (diff.removed.length) parts.push(`removed ${diff.removed.length}`)
    if (parts.length) lines.push(`- ${parts.join(', ')} file(s).`)
  }

  lines.push(`- Updated SOUL.md.`)
  return lines.join('\n')
}

export async function generateSoulChangelogForPublish(
  ctx: ActionCtx,
  args: { slug: string; version: string; readmeText: string; files: FileMeta[] },
): Promise<string> {
  try {
    const soul = (await ctx.runQuery(internal.souls.getSoulBySlugInternal, {
      slug: args.slug,
    })) as Doc<'souls'> | null
    const previous: Doc<'soulVersions'> | null =
      soul?.latestVersionId && !soul.softDeletedAt
        ? ((await ctx.runQuery(internal.souls.getVersionByIdInternal, {
            versionId: soul.latestVersionId,
          })) as Doc<'soulVersions'> | null)
        : null

    const oldReadmeText: string | null = previous
      ? await readReadmeFromVersion(ctx, previous)
      : null
    const oldFiles = previous
      ? previous.files.map((file) => ({ path: file.path, sha256: file.sha256 }))
      : []
    const fileDiff = previous ? summarizeFileDiff(oldFiles, args.files) : null

    const ai = await generateWithOpenAI({
      slug: args.slug,
      version: args.version,
      oldReadme: oldReadmeText,
      nextReadme: args.readmeText,
      fileDiff,
    }).catch(() => null)

    return (
      ai ??
      generateFallback({
        slug: args.slug,
        version: args.version,
        oldReadme: oldReadmeText,
        nextReadme: args.readmeText,
        fileDiff,
      })
    )
  } catch {
    return '- Updated soul.'
  }
}

export async function generateSoulChangelogPreview(
  ctx: ActionCtx,
  args: {
    slug: string
    version: string
    readmeText: string
    filePaths?: string[]
  },
): Promise<string> {
  try {
    const soul = (await ctx.runQuery(internal.souls.getSoulBySlugInternal, {
      slug: args.slug,
    })) as Doc<'souls'> | null
    const previous: Doc<'soulVersions'> | null =
      soul?.latestVersionId && !soul.softDeletedAt
        ? ((await ctx.runQuery(internal.souls.getVersionByIdInternal, {
            versionId: soul.latestVersionId,
          })) as Doc<'soulVersions'> | null)
        : null

    const oldReadmeText: string | null = previous
      ? await readReadmeFromVersion(ctx, previous)
      : null
    const oldPaths = previous ? previous.files.map((file) => file.path) : []
    const nextPaths = args.filePaths ?? []
    const diff = previous ? summarizeFileDiffFromPaths(oldPaths, nextPaths) : null

    const ai = await generateWithOpenAI({
      slug: args.slug,
      version: args.version,
      oldReadme: oldReadmeText,
      nextReadme: args.readmeText,
      fileDiff: diff,
    }).catch(() => null)

    return (
      ai ??
      generateFallback({
        slug: args.slug,
        version: args.version,
        oldReadme: oldReadmeText,
        nextReadme: args.readmeText,
        fileDiff: diff,
      })
    )
  } catch {
    return '- Updated soul.'
  }
}

async function readReadmeFromVersion(ctx: ActionCtx, version: Doc<'soulVersions'>) {
  const file = version.files.find((entry) => entry.path.toLowerCase() === 'soul.md')
  if (!file) return null
  const blob = await ctx.storage.get(file.storageId)
  if (!blob) return null
  return blob.text()
}

function summarizeFileDiffFromPaths(oldPaths: string[], nextPaths: string[]) {
  const oldFiles = oldPaths.map((path) => ({ path }))
  const nextFiles = nextPaths.map((path) => ({ path }))
  return summarizeFileDiff(oldFiles, nextFiles)
}

export const __test = {
  summarizeFileDiff,
}
