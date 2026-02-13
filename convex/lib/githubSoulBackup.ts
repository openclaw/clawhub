'use node'

import { createPrivateKey, createSign } from 'node:crypto'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'

const GITHUB_API = 'https://api.github.com'
const DEFAULT_REPO = 'clawdbot/souls'
const DEFAULT_ROOT = 'souls'
const META_FILENAME = '_meta.json'
const USER_AGENT = 'clawhub/souls-backup'

type BackupFile = {
  path: string
  size: number
  storageId: Id<'_storage'>
  sha256: string
  contentType?: string
}

type BackupParams = {
  slug: string
  version: string
  displayName: string
  ownerHandle: string
  files: BackupFile[]
  publishedAt: number
}

type RepoInfo = {
  default_branch?: string
}

type GitRef = {
  object: { sha: string }
}

type GitCommit = {
  sha: string
  tree: { sha: string }
}

type GitTreeEntry = {
  path?: string
  type?: string
}

type GitTree = {
  tree?: GitTreeEntry[]
}

type MetaFile = {
  owner: string
  slug: string
  displayName: string
  latest: {
    version: string
    publishedAt: number
    commit: string | null
  }
  history: Array<{
    version: string
    publishedAt: number
    commit: string
  }>
}

export type GitHubBackupContext = {
  token: string
  repo: string
  repoOwner: string
  repoName: string
  branch: string
  root: string
}

export function isGitHubSoulBackupConfigured() {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_APP_INSTALLATION_ID,
  )
}

export async function getGitHubSoulBackupContext(): Promise<GitHubBackupContext> {
  const repo = process.env.GITHUB_SOULS_REPO ?? DEFAULT_REPO
  const root = process.env.GITHUB_SOULS_ROOT ?? DEFAULT_ROOT
  const [repoOwner, repoName] = parseRepo(repo)
  const token = await createInstallationToken()
  const repoInfo = await githubGet<RepoInfo>(token, `/repos/${repoOwner}/${repoName}`)
  const branch = repoInfo.default_branch ?? 'main'

  return { token, repo, repoOwner, repoName, branch, root }
}

export async function fetchGitHubSoulMeta(
  context: GitHubBackupContext,
  ownerHandle: string,
  slug: string,
): Promise<MetaFile | null> {
  const soulRoot = buildSoulRoot(context.root, ownerHandle, slug)
  return fetchMetaFile(
    context.token,
    context.repoOwner,
    context.repoName,
    `${soulRoot}/${META_FILENAME}`,
    context.branch,
  )
}

export async function backupSoulToGitHub(
  ctx: ActionCtx,
  params: BackupParams,
  context?: GitHubBackupContext,
) {
  if (!isGitHubSoulBackupConfigured()) return

  const resolved = context ?? (await getGitHubSoulBackupContext())
  const soulRoot = buildSoulRoot(resolved.root, params.ownerHandle, params.slug)
  const ref = await githubGet<GitRef>(
    resolved.token,
    `/repos/${resolved.repoOwner}/${resolved.repoName}/git/ref/heads/${resolved.branch}`,
  )
  const baseCommitSha = ref.object.sha
  const baseCommit = await githubGet<GitCommit>(
    resolved.token,
    `/repos/${resolved.repoOwner}/${resolved.repoName}/git/commits/${baseCommitSha}`,
  )
  const baseTreeSha = baseCommit.tree.sha
  const existingTree = await githubGet<GitTree>(
    resolved.token,
    `/repos/${resolved.repoOwner}/${resolved.repoName}/git/trees/${baseTreeSha}?recursive=1`,
  )

  const prefix = `${soulRoot}/`
  const existingPaths = new Set(
    (existingTree.tree ?? [])
      .filter((entry) => entry.type === 'blob' && entry.path?.startsWith(prefix))
      .map((entry) => entry.path ?? ''),
  )

  const newPaths = new Set<string>()
  const treeEntries: Array<{
    path: string
    mode: '100644'
    type: 'blob'
    sha: string | null
  }> = []

  for (const file of params.files) {
    const content = await fetchStorageBase64(ctx, file.storageId)
    const blobSha = await createBlob(resolved.token, resolved.repoOwner, resolved.repoName, content)
    const path = `${soulRoot}/${file.path}`
    newPaths.add(path)
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: blobSha })
  }

  const existingMeta = await fetchMetaFile(
    resolved.token,
    resolved.repoOwner,
    resolved.repoName,
    `${soulRoot}/${META_FILENAME}`,
    resolved.branch,
  )
  const metaPath = `${soulRoot}/${META_FILENAME}`
  const metaDraft = buildMetaFile(params, existingMeta, resolved.repo, baseCommitSha, null)
  const metaDraftContent = `${JSON.stringify(metaDraft, null, 2)}\n`
  const metaDraftSha = await createBlob(
    resolved.token,
    resolved.repoOwner,
    resolved.repoName,
    toBase64(metaDraftContent),
  )
  newPaths.add(metaPath)
  treeEntries.push({ path: metaPath, mode: '100644', type: 'blob', sha: metaDraftSha })

  for (const path of existingPaths) {
    if (newPaths.has(path)) continue
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: null })
  }

  const newTree = await githubPost<{ sha: string }>(
    resolved.token,
    `/repos/${resolved.repoOwner}/${resolved.repoName}/git/trees`,
    {
      base_tree: baseTreeSha,
      tree: treeEntries,
    },
  )

  const commit = await githubPost<GitCommit>(
    resolved.token,
    `/repos/${resolved.repoOwner}/${resolved.repoName}/git/commits`,
    {
      message: `soul: ${params.slug} v${params.version}`,
      tree: newTree.sha,
      parents: [baseCommitSha],
    },
  )

  const metaFinal = buildMetaFile(params, existingMeta, resolved.repo, baseCommitSha, commit.sha)
  const metaFinalContent = `${JSON.stringify(metaFinal, null, 2)}\n`
  const metaFinalSha = await createBlob(
    resolved.token,
    resolved.repoOwner,
    resolved.repoName,
    toBase64(metaFinalContent),
  )
  const metaTree = await githubPost<{ sha: string }>(
    resolved.token,
    `/repos/${resolved.repoOwner}/${resolved.repoName}/git/trees`,
    {
      base_tree: commit.tree.sha,
      tree: [{ path: metaPath, mode: '100644', type: 'blob', sha: metaFinalSha }],
    },
  )
  const metaCommit = await githubPost<GitCommit>(
    resolved.token,
    `/repos/${resolved.repoOwner}/${resolved.repoName}/git/commits`,
    {
      message: `meta: ${params.slug} v${params.version}`,
      tree: metaTree.sha,
      parents: [commit.sha],
    },
  )

  await githubPatch(
    resolved.token,
    `/repos/${resolved.repoOwner}/${resolved.repoName}/git/refs/heads/${resolved.branch}`,
    {
      sha: metaCommit.sha,
    },
  )
}

function buildMetaFile(
  params: BackupParams,
  existing: MetaFile | null,
  repo: string,
  baseCommitSha: string,
  latestCommitSha: string | null,
): MetaFile {
  let history = [...(existing?.history ?? [])]
  if (existing?.latest?.version) {
    const previousCommit = existing.latest.commit ?? commitUrl(repo, baseCommitSha)
    const previous = {
      version: existing.latest.version,
      publishedAt: existing.latest.publishedAt,
      commit: previousCommit,
    }
    history = [previous, ...history.filter((entry) => entry.version !== previous.version)]
  }

  return {
    owner: normalizeOwner(params.ownerHandle),
    slug: params.slug,
    displayName: params.displayName,
    latest: {
      version: params.version,
      publishedAt: params.publishedAt,
      commit: latestCommitSha ? commitUrl(repo, latestCommitSha) : null,
    },
    history: history.slice(0, 200),
  }
}

async function fetchMetaFile(
  token: string,
  repoOwner: string,
  repoName: string,
  path: string,
  branch: string,
): Promise<MetaFile | null> {
  try {
    const response = await githubGet<{ content?: string }>(
      token,
      `/repos/${repoOwner}/${repoName}/contents/${encodePath(path)}?ref=${branch}`,
    )
    if (!response.content) return null
    const raw = fromBase64(response.content)
    return JSON.parse(raw) as MetaFile
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

async function fetchStorageBase64(ctx: ActionCtx, storageId: Id<'_storage'>) {
  const blob = await ctx.storage.get(storageId)
  if (!blob) throw new Error('File missing in storage')
  const buffer = Buffer.from(await blob.arrayBuffer())
  return buffer.toString('base64')
}

async function createInstallationToken() {
  const appId = process.env.GITHUB_APP_ID
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID
  if (!appId || !installationId) {
    throw new Error('GitHub App credentials missing')
  }
  const jwt = createAppJwt(appId)
  const response = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: buildHeaders(jwt, true),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`GitHub App token failed: ${message}`)
  }
  const payload = (await response.json()) as { token?: string }
  if (!payload.token) throw new Error('GitHub App token missing')
  return payload.token
}

function createAppJwt(appId: string) {
  const privateKey = loadPrivateKey()
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId }
  const encodedHeader = base64Url(JSON.stringify(header))
  const encodedPayload = base64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  sign.end()
  const signature = sign.sign(privateKey)
  return `${signingInput}.${base64Url(signature)}`
}

function loadPrivateKey() {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY
  if (!raw) throw new Error('GITHUB_APP_PRIVATE_KEY is not configured')
  const normalized = raw.replace(/\\n/g, '\n')
  return createPrivateKey(normalized)
}

async function createBlob(token: string, repoOwner: string, repoName: string, content: string) {
  const result = await githubPost<{ sha: string }>(
    token,
    `/repos/${repoOwner}/${repoName}/git/blobs`,
    {
      content,
      encoding: 'base64',
    },
  )
  if (!result.sha) throw new Error('GitHub blob missing sha')
  return result.sha
}

async function githubGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: buildHeaders(token),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`GitHub GET ${path} failed: ${message}`)
  }
  return (await response.json()) as T
}

async function githubPost<T>(token: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`GitHub POST ${path} failed: ${message}`)
  }
  return (await response.json()) as T
}

async function githubPatch(token: string, path: string, body: unknown) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method: 'PATCH',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`GitHub PATCH ${path} failed: ${message}`)
  }
}

function buildHeaders(token: string, isAppJwt = false) {
  return {
    Authorization: `${isAppJwt ? 'Bearer' : 'token'} ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  }
}

function parseRepo(repo: string) {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error('GITHUB_SOULS_REPO must be owner/repo')
  return [owner, name] as const
}

function normalizeOwner(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'unknown'
}

function commitUrl(repo: string, sha: string) {
  return `https://github.com/${repo}/commit/${sha}`
}

function buildSoulRoot(root: string, ownerHandle: string, slug: string) {
  const ownerSegment = normalizeOwner(ownerHandle)
  return `${root}/${ownerSegment}/${slug}`
}

function encodePath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function base64Url(value: string | Buffer) {
  const buffer = typeof value === 'string' ? Buffer.from(value) : value
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function toBase64(value: string) {
  return Buffer.from(value).toString('base64')
}

function fromBase64(value: string) {
  return Buffer.from(value, 'base64').toString('utf8')
}

function isNotFoundError(error: unknown) {
  return (
    error instanceof Error && (error.message.includes('404') || error.message.includes('Not Found'))
  )
}
