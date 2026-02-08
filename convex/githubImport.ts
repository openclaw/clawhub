import { ConvexError, v } from 'convex/values'
import { unzipSync } from 'fflate'
import semver from 'semver'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { action } from './_generated/server'
import { requireUserFromAction } from './lib/access'
import {
  buildGitHubImportFileList,
  computeDefaultSelectedPaths,
  detectGitHubImportCandidates,
  fetchGitHubZipBytes,
  listTextFilesUnderCandidate,
  normalizeRepoPath,
  parseGitHubImportUrl,
  resolveGitHubCommit,
  stripGitHubZipRoot,
  suggestDisplayName,
  suggestVersion,
} from './lib/githubImport'
import { publishVersionForUser } from './lib/skillPublish'
import { sanitizePath } from './lib/skills'

const MAX_SELECTED_BYTES = 50 * 1024 * 1024
const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024
const MAX_FILE_COUNT = 7_500
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024

export const previewGitHubImport = action({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    await requireUserFromAction(ctx)

    const parsed = parseGitHubImportUrl(args.url)
    const resolved = await resolveGitHubCommit(parsed, fetch)
    const zipBytes = await fetchGitHubZipBytes(resolved, fetch)
    const entries = unzipToEntries(zipBytes)
    const stripped = stripGitHubZipRoot(entries)
    const candidates = detectGitHubImportCandidates(stripped).filter((candidate) =>
      isCandidateUnderResolvedPath(candidate.path, resolved.path),
    )
    if (candidates.length === 0) throw new ConvexError('No SKILL.md found in this repo')

    return {
      resolved,
      candidates: candidates.map((candidate) => ({
        path: candidate.path,
        readmePath: candidate.readmePath,
        name: candidate.name ?? null,
        description: candidate.description ?? null,
      })),
    }
  },
})

export const previewGitHubImportCandidate = action({
  args: { url: v.string(), candidatePath: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUserFromAction(ctx)

    const parsed = parseGitHubImportUrl(args.url)
    const resolved = await resolveGitHubCommit(parsed, fetch)
    const zipBytes = await fetchGitHubZipBytes(resolved, fetch)
    const entries = unzipToEntries(zipBytes)
    const stripped = stripGitHubZipRoot(entries)

    const normalizedCandidatePath = normalizeRepoPath(args.candidatePath)
    if (!isCandidateUnderResolvedPath(normalizedCandidatePath, resolved.path)) {
      throw new ConvexError('Candidate path is outside the requested import scope')
    }

    const candidates = detectGitHubImportCandidates(stripped).filter((candidate) =>
      isCandidateUnderResolvedPath(candidate.path, resolved.path),
    )

    const candidate = candidates.find((item) => item.path === normalizedCandidatePath)
    if (!candidate) throw new ConvexError('Candidate not found')

    const files = listTextFilesUnderCandidate(stripped, candidate.path)
    const defaultSelectedPaths = computeDefaultSelectedPaths({ candidate, files })
    const fileList = buildGitHubImportFileList({
      candidate,
      files,
      defaultSelectedPaths,
    })

    const pathParts = candidate.path ? candidate.path.split('/') : []
    const baseForNaming = candidate.path ? (pathParts[pathParts.length - 1] ?? '') : resolved.repo
    const suggestedDisplayName = suggestDisplayName(candidate, baseForNaming)

    const rawSlugBase = sanitizeSlug(candidate.path ? baseForNaming : resolved.repo)
    const suggestedSlug = await suggestAvailableSlug(ctx, userId, rawSlugBase)

    const existing = await ctx.runQuery(api.skills.getBySlug, { slug: suggestedSlug })
    const existingLatest =
      existing?.skill && existing.skill.ownerUserId === userId
        ? (existing.latestVersion?.version ?? null)
        : null
    const suggestedVersion = suggestVersion(existingLatest)

    return {
      resolved,
      candidate: {
        path: candidate.path,
        readmePath: candidate.readmePath,
        name: candidate.name ?? null,
        description: candidate.description ?? null,
      },
      defaults: {
        selectedPaths: defaultSelectedPaths,
        slug: suggestedSlug,
        displayName: suggestedDisplayName,
        version: suggestedVersion,
        tags: ['latest'],
      },
      files: fileList,
    }
  },
})

export const importGitHubSkill = action({
  args: {
    url: v.string(),
    commit: v.string(),
    candidatePath: v.string(),
    selectedPaths: v.array(v.string()),
    slug: v.optional(v.string()),
    displayName: v.optional(v.string()),
    version: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUserFromAction(ctx)

    const parsed = parseGitHubImportUrl(args.url)
    const resolved = await resolveGitHubCommit(parsed, fetch)
    if (!/^[a-f0-9]{40}$/i.test(args.commit)) throw new ConvexError('Invalid commit')
    if (args.commit.toLowerCase() !== resolved.commit.toLowerCase()) {
      throw new ConvexError('Import is out of date. Re-run preview.')
    }

    const normalizedCandidatePath = normalizeRepoPath(args.candidatePath)
    if (!isCandidateUnderResolvedPath(normalizedCandidatePath, resolved.path)) {
      throw new ConvexError('Candidate path is outside the requested import scope')
    }

    const zipBytes = await fetchGitHubZipBytes(resolved, fetch)
    const entries = stripGitHubZipRoot(unzipToEntries(zipBytes))

    const candidates = detectGitHubImportCandidates(entries).filter((candidate) =>
      isCandidateUnderResolvedPath(candidate.path, resolved.path),
    )
    const candidate = candidates.find((item) => item.path === normalizedCandidatePath)
    if (!candidate) throw new ConvexError('Candidate not found')

    const filesUnderCandidate = listTextFilesUnderCandidate(entries, candidate.path)
    const byPath = new Map(filesUnderCandidate.map((file) => [file.path, file.bytes]))

    const selected = Array.from(
      new Set(args.selectedPaths.map((path) => normalizeRepoPath(path)).filter(Boolean)),
    )
    if (selected.length === 0) throw new ConvexError('No files selected')

    const candidateRoot = candidate.path ? `${candidate.path}/` : ''
    const normalizedReadmePath = normalizeRepoPath(candidate.readmePath)
    if (!selected.includes(normalizedReadmePath)) {
      throw new ConvexError('SKILL.md must be selected')
    }

    let totalBytes = 0
    const storedFiles: Array<{
      path: string
      size: number
      storageId: Id<'_storage'>
      sha256: string
      contentType?: string
    }> = []

    for (const path of selected.sort()) {
      if (candidateRoot && !path.startsWith(candidateRoot)) {
        throw new ConvexError('Selected file is outside the chosen skill folder')
      }

      const bytes = byPath.get(path)
      if (!bytes) continue
      totalBytes += bytes.byteLength
      if (totalBytes > MAX_SELECTED_BYTES) throw new ConvexError('Selected files exceed 50MB limit')

      const relPath = candidateRoot ? path.slice(candidateRoot.length) : path
      const sanitized = sanitizePath(relPath)
      if (!sanitized) throw new ConvexError('Invalid file paths')

      const sha256 = await sha256Hex(bytes)
      const safeBytes = new Uint8Array(bytes)
      const storageId = await ctx.storage.store(new Blob([safeBytes], { type: 'text/plain' }))
      storedFiles.push({
        path: sanitized,
        size: bytes.byteLength,
        storageId,
        sha256,
        contentType: 'text/plain',
      })
    }

    if (storedFiles.length === 0) throw new ConvexError('No files selected')

    const slugBase = (args.slug ?? '').trim().toLowerCase()
    const displayName = (args.displayName ?? '').trim()
    const tags = (args.tags ?? ['latest']).map((tag) => tag.trim()).filter(Boolean)
    const version = (args.version ?? '').trim()

    if (!slugBase) throw new ConvexError('Slug required')
    if (!displayName) throw new ConvexError('Display name required')
    if (!version || !semver.valid(version)) throw new ConvexError('Version must be valid semver')

    const result = await publishVersionForUser(ctx, userId, {
      slug: slugBase,
      displayName,
      version,
      changelog: '',
      tags,
      files: storedFiles,
      source: {
        kind: 'github',
        url: resolved.originalUrl,
        repo: `${resolved.owner}/${resolved.repo}`,
        ref: resolved.ref,
        commit: resolved.commit,
        path: candidate.path,
        importedAt: Date.now(),
      },
    })

    return { ok: true, slug: slugBase, version, ...result }
  },
})

function unzipToEntries(zipBytes: Uint8Array) {
  const entries = unzipSync(zipBytes)
  const out: Record<string, Uint8Array> = {}
  const rawPaths = Object.keys(entries)
  if (rawPaths.length > MAX_FILE_COUNT) throw new ConvexError('Repo archive has too many files')
  let totalBytes = 0
  for (const [rawPath, bytes] of Object.entries(entries)) {
    const normalizedPath = normalizeZipPath(rawPath)
    if (!normalizedPath) continue
    if (isJunkPath(normalizedPath)) continue
    if (!bytes) continue
    if (bytes.byteLength > MAX_SINGLE_FILE_BYTES) continue
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_UNZIPPED_BYTES) throw new ConvexError('Repo archive is too large')
    out[normalizedPath] = bytes
  }
  return out
}

function isCandidateUnderResolvedPath(candidatePath: string, resolvedPath: string) {
  const root = normalizeRepoPath(resolvedPath)
  if (!root) return true
  if (!candidatePath) return false
  if (candidatePath === root) return true
  return candidatePath.startsWith(`${root}/`)
}

function sanitizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .replace(/--+/g, '-')
}

async function suggestAvailableSlug(ctx: ActionCtx, userId: Id<'users'>, base: string) {
  const cleaned = sanitizeSlug(base)
  if (!cleaned) throw new ConvexError('Could not derive slug')
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? cleaned : `${cleaned}-${i + 1}`
    const existing = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug: candidate })
    if (!existing) return candidate
    if (existing.ownerUserId === userId) return candidate
  }
  throw new ConvexError('Could not find an available slug')
}

async function sha256Hex(bytes: Uint8Array) {
  const normalized = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', normalized.buffer)
  return toHex(new Uint8Array(digest))
}

function toHex(bytes: Uint8Array) {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function normalizeZipPath(path: string) {
  const normalized = path
    .replaceAll('\u0000', '')
    .replaceAll('\\', '/')
    .trim()
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
  if (!normalized) return ''
  if (normalized.includes('..')) return ''
  return normalized
}

function isJunkPath(path: string) {
  const normalized = path.toLowerCase()
  if (normalized.startsWith('__macosx/')) return true
  if (normalized.endsWith('/.ds_store')) return true
  if (normalized === '.ds_store') return true
  return false
}
