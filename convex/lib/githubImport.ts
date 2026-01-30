import { zipSync } from 'fflate'
import { TEXT_FILE_EXTENSION_SET } from 'molthub-schema'
import semver from 'semver'
import { parseFrontmatter } from './skills'

export type GitHubImportUrl = {
  owner: string
  repo: string
  ref?: string
  path?: string
  originalUrl: string
}

export type GitHubImportResolved = {
  owner: string
  repo: string
  ref: string
  commit: string
  path: string
  repoUrl: string
  originalUrl: string
}

export type GitHubImportCandidate = {
  path: string
  readmePath: string
  name?: string
  description?: string
}

export type GitHubImportFileEntry = {
  path: string
  size: number
  defaultSelected: boolean
}

const MAX_REDIRECTS = 6
const GITHUB_HOST = 'github.com'
const CODELOAD_HOST = 'codeload.github.com'
const SKILL_FILENAMES = ['skill.md', 'skills.md']

export function parseGitHubImportUrl(input: string): GitHubImportUrl {
  const originalUrl = input.trim()
  let url: URL
  try {
    url = new URL(originalUrl)
  } catch {
    throw new Error('Invalid URL')
  }
  if (url.protocol !== 'https:') throw new Error('Only https:// URLs are supported')
  if (url.hostname !== GITHUB_HOST) throw new Error('Only github.com URLs are supported')

  const segments = url.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        throw new Error('Invalid URL')
      }
    })

  const owner = segments[0] ?? ''
  const repo = (segments[1] ?? '').replace(/\.git$/, '')
  if (!owner || !repo) throw new Error('GitHub URL must be /<owner>/<repo>')

  const kind = segments[2] ?? ''
  if (!kind) return { owner, repo, originalUrl }
  if (kind !== 'tree' && kind !== 'blob') {
    return { owner, repo, originalUrl }
  }

  const ref = segments[3] ?? ''
  if (!ref) throw new Error('Missing ref in GitHub URL')

  const rest = segments.slice(4).join('/')
  const normalizedRest = normalizeRepoPath(rest)

  if (kind === 'blob') {
    if (!rest) throw new Error('Missing path in GitHub URL')
    if (!normalizedRest) throw new Error('Invalid path in GitHub URL')
    const dir = normalizedRest.split('/').slice(0, -1).join('/')
    return { owner, repo, ref, path: dir || undefined, originalUrl }
  }

  if (rest && !normalizedRest) throw new Error('Invalid path in GitHub URL')
  return { owner, repo, ref, path: normalizedRest || undefined, originalUrl }
}

export async function resolveGitHubCommit(
  parsed: GitHubImportUrl,
  fetcher: typeof fetch,
): Promise<GitHubImportResolved> {
  const repoUrl = `https://${GITHUB_HOST}/${parsed.owner}/${parsed.repo}`
  const ref = parsed.ref?.trim() || 'HEAD'
  const path = normalizeRepoPath(parsed.path ?? '')

  const commit =
    ref === 'HEAD'
      ? await resolveHeadCommit(parsed, fetcher)
      : await resolveRefCommit(parsed, ref, fetcher)

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    ref,
    commit,
    path,
    repoUrl,
    originalUrl: parsed.originalUrl,
  }
}

async function resolveRefCommit(parsed: GitHubImportUrl, ref: string, fetcher: typeof fetch) {
  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(ref)}`
  const response = await fetcher(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'clawhub/github-import',
    },
  })
  if (!response.ok) throw new Error('GitHub ref not found')
  const body = (await response.json()) as { sha?: unknown }
  const sha = typeof body.sha === 'string' ? body.sha : ''
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('GitHub commit sha missing')
  return sha.toLowerCase()
}

async function resolveHeadCommit(parsed: GitHubImportUrl, fetcher: typeof fetch) {
  let url = `https://${GITHUB_HOST}/${parsed.owner}/${parsed.repo}/archive/HEAD.zip`
  for (let i = 0; i < MAX_REDIRECTS; i += 1) {
    const response = await fetcher(url, { redirect: 'manual' })
    const location = response.headers.get('location')
    if (!location) break
    const next = new URL(location, url)
    if (next.hostname !== GITHUB_HOST && next.hostname !== CODELOAD_HOST) {
      throw new Error('Unexpected redirect host')
    }
    url = next.toString()
  }

  const maybe = url.split('/').at(-1) ?? ''
  if (!/^[a-f0-9]{40}$/i.test(maybe)) {
    throw new Error('Could not resolve commit for HEAD')
  }
  return maybe.toLowerCase()
}

export async function fetchGitHubZipBytes(
  resolved: GitHubImportResolved,
  fetcher: typeof fetch,
  limits?: { maxZipBytes?: number },
): Promise<Uint8Array> {
  const maxZipBytes = limits?.maxZipBytes ?? 25 * 1024 * 1024
  const url = `https://${CODELOAD_HOST}/${resolved.owner}/${resolved.repo}/zip/${resolved.commit}`
  const response = await fetcher(url, {
    headers: { 'User-Agent': 'clawhub/github-import' },
  })
  if (!response.ok) throw new Error('GitHub archive download failed')

  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader) {
    const contentLength = Number.parseInt(lengthHeader, 10)
    if (Number.isFinite(contentLength) && contentLength > maxZipBytes) {
      throw new Error('GitHub archive too large')
    }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxZipBytes) throw new Error('GitHub archive too large')
    return buffer
  }

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxZipBytes) throw new Error('GitHub archive too large')
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export type ZipEntryMap = Record<string, Uint8Array>

export function buildGitHubZipForTests(entries: Record<string, string>) {
  const asBytes = Object.fromEntries(
    Object.entries(entries).map(([path, text]) => [path, new TextEncoder().encode(text)]),
  )
  return Uint8Array.from(zipSync(asBytes, { level: 1 }))
}

export function stripGitHubZipRoot(entries: ZipEntryMap): ZipEntryMap {
  const paths = Object.keys(entries)
  if (paths.length === 0) return {}
  const first = paths[0] ?? ''
  const firstRoot = first.split('/')[0] ?? ''
  if (!firstRoot) return entries
  const prefix = `${firstRoot}/`
  if (!paths.every((path) => path.startsWith(prefix))) return entries
  const out: ZipEntryMap = {}
  for (const [path, data] of Object.entries(entries)) {
    const stripped = path.slice(prefix.length)
    if (!stripped) continue
    out[stripped] = data
  }
  return out
}

export function detectGitHubImportCandidates(entries: ZipEntryMap): GitHubImportCandidate[] {
  const candidates: GitHubImportCandidate[] = []
  for (const path of Object.keys(entries)) {
    const normalized = normalizeRepoPath(path)
    const lower = normalized.toLowerCase()
    const isSkill = SKILL_FILENAMES.some((name) => lower === name || lower.endsWith(`/${name}`))
    if (!isSkill) continue
    const dir = normalized.split('/').slice(0, -1).join('/')
    const readmePath = normalized
    const raw = new TextDecoder().decode(entries[path] ?? new Uint8Array())
    const frontmatter = parseFrontmatter(raw)
    const name = typeof frontmatter.name === 'string' ? frontmatter.name : undefined
    const description =
      typeof frontmatter.description === 'string' ? frontmatter.description : undefined
    candidates.push({
      path: normalizeRepoPath(dir),
      readmePath,
      name: name?.trim() || undefined,
      description: description?.trim() || undefined,
    })
  }
  return uniqCandidates(candidates)
}

function uniqCandidates(candidates: GitHubImportCandidate[]) {
  const seen = new Set<string>()
  const out: GitHubImportCandidate[] = []
  for (const candidate of candidates) {
    const key = `${candidate.path}::${candidate.readmePath}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function listTextFilesUnderCandidate(
  entries: ZipEntryMap,
  candidatePath: string,
): Array<{ path: string; bytes: Uint8Array }> {
  const root = normalizeCandidateRoot(candidatePath)
  const out: Array<{ path: string; bytes: Uint8Array }> = []
  for (const [path, bytes] of Object.entries(entries)) {
    const normalized = normalizeRepoPath(path)
    if (!isUnderRoot(normalized, root)) continue
    if (!isTextPath(normalized)) continue
    out.push({ path: normalized, bytes })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function computeDefaultSelectedPaths(params: {
  candidate: GitHubImportCandidate
  files: Array<{ path: string; bytes: Uint8Array }>
  maxDepth?: number
  maxAdds?: number
}) {
  const maxDepth = params.maxDepth ?? 4
  const maxAdds = params.maxAdds ?? 200
  const byPath = new Map(params.files.map((file) => [file.path, file.bytes]))
  const candidateRoot = normalizeCandidateRoot(params.candidate.path)
  const selected = new Set<string>()
  let added = 0

  const add = (path: string) => {
    const normalized = normalizeRepoPath(path)
    if (!isUnderRoot(normalized, candidateRoot)) return
    if (!byPath.has(normalized)) return
    if (!selected.has(normalized)) {
      selected.add(normalized)
      added += 1
    }
  }

  add(params.candidate.readmePath)

  const visited = new Set<string>()
  const queue: Array<{ path: string; depth: number }> = [
    { path: params.candidate.readmePath, depth: 0 },
  ]

  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break
    if (item.depth >= maxDepth) continue
    if (visited.has(item.path)) continue
    visited.add(item.path)

    const bytes = byPath.get(item.path)
    if (!bytes) continue
    if (!item.path.toLowerCase().endsWith('.md')) continue

    const text = new TextDecoder().decode(bytes)
    const refs = extractMarkdownRelativeTargets(text)
    for (const ref of refs) {
      if (added >= maxAdds) break
      const resolved = resolveMarkdownTarget(item.path, ref)
      if (!resolved) continue
      add(resolved)
      if (resolved.toLowerCase().endsWith('.md') && byPath.has(resolved)) {
        queue.push({ path: resolved, depth: item.depth + 1 })
      }
    }
    if (added >= maxAdds) break
  }

  return Array.from(selected).sort()
}

export function buildGitHubImportFileList(params: {
  candidate: GitHubImportCandidate
  files: Array<{ path: string; bytes: Uint8Array }>
  defaultSelectedPaths: string[]
}): GitHubImportFileEntry[] {
  const selected = new Set(params.defaultSelectedPaths)
  return params.files.map((file) => ({
    path: file.path,
    size: file.bytes.byteLength,
    defaultSelected: selected.has(file.path),
  }))
}

export function normalizeRepoPath(path: string) {
  const stripped = path.replace(/^\/+/, '').trim()
  if (!stripped) return ''
  const cleaned = stripped.split('/').filter(Boolean).join('/')
  if (!cleaned || cleaned.includes('\\') || cleaned.includes('..')) return ''
  return cleaned
}

export function normalizeCandidateRoot(candidatePath: string) {
  const normalized = normalizeRepoPath(candidatePath)
  return normalized ? `${normalized}/` : ''
}

function isUnderRoot(path: string, rootWithSlash: string) {
  if (!rootWithSlash) return true
  return path === rootWithSlash.slice(0, -1) || path.startsWith(rootWithSlash)
}

function isTextPath(path: string) {
  const lower = path.toLowerCase()
  const ext = lower.split('.').at(-1) ?? ''
  if (!ext) return false
  return TEXT_FILE_EXTENSION_SET.has(ext)
}

export function suggestDisplayName(candidate: GitHubImportCandidate, fallbackBase: string) {
  const base = candidate.name?.trim() || fallbackBase.trim()
  if (!base) return ''
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function suggestVersion(latestVersion?: string | null) {
  const latest = latestVersion?.trim() || ''
  if (latest && semver.valid(latest)) {
    return semver.inc(latest, 'patch') ?? '0.1.0'
  }
  return '0.1.0'
}

export function extractMarkdownRelativeTargets(markdown: string): string[] {
  const out: string[] = []
  const pattern = /!?\[[^\]]*]\(([^)]+)\)/g
  for (const match of markdown.matchAll(pattern)) {
    const raw = (match[1] ?? '').trim()
    if (!raw) continue
    const isAngleWrapped = raw.startsWith('<') && raw.endsWith('>')
    const cleaned = raw.replace(/^<|>$/g, '').trim()
    if (!cleaned) continue
    const target = isAngleWrapped ? cleaned : (cleaned.split(/\s+/)[0] ?? '')
    if (!target) continue
    if (target.startsWith('#')) continue
    const lower = target.toLowerCase()
    if (lower.startsWith('http:') || lower.startsWith('https:')) continue
    if (lower.startsWith('mailto:')) continue
    out.push(target)
  }
  return out
}

export function resolveMarkdownTarget(fromPath: string, target: string) {
  const withoutHash = target.split('#')[0] ?? ''
  const withoutQuery = (withoutHash.split('?')[0] ?? '').trim()
  if (!withoutQuery) return null
  if (withoutQuery.startsWith('/')) return null
  if (withoutQuery.includes('\\') || withoutQuery.includes('..')) return null

  const fromDirParts = normalizeRepoPath(fromPath).split('/').slice(0, -1)
  const targetParts = withoutQuery.split('/').filter(Boolean)
  const combined = [...fromDirParts, ...targetParts]
  const normalized: string[] = []
  for (const part of combined) {
    if (part === '.') continue
    if (part === '..') return null
    normalized.push(part)
  }
  return normalizeRepoPath(normalized.join('/')) || null
}
