'use node'

import type { GitHubBackupContext } from './githubBackup'

const GITHUB_API = 'https://api.github.com'
const META_FILENAME = '_meta.json'
const USER_AGENT = 'clawhub/skills-restore'

type GitHubContentsEntry = {
  name?: string
  path?: string
  type?: string // 'file' | 'dir'
  size?: number
}

type GitHubBlobResponse = {
  content?: string
  encoding?: string
  size?: number
}

/**
 * List all files in a skill's backup directory (excluding _meta.json).
 * Uses the Contents API scoped to the target directory instead of fetching
 * the entire repository tree, which is critical for bulk restore performance.
 * Returns relative file paths (e.g. "SKILL.md", "lib/helper.ts").
 */
export async function listGitHubBackupFiles(
  context: GitHubBackupContext,
  ownerHandle: string,
  slug: string,
): Promise<string[]> {
  const skillRoot = buildSkillRoot(context.root, ownerHandle, slug)
  return listFilesRecursive(context, skillRoot, '')
}

/**
 * Recursively list files under a directory using the GitHub Contents API.
 * Each call is scoped to one directory, avoiding full-repo tree downloads.
 */
async function listFilesRecursive(
  context: GitHubBackupContext,
  basePath: string,
  relativePath: string,
): Promise<string[]> {
  const dirPath = relativePath ? `${basePath}/${relativePath}` : basePath

  try {
    const entries = await githubGet<GitHubContentsEntry[]>(
      context.token,
      `/repos/${context.repoOwner}/${context.repoName}/contents/${encodePath(dirPath)}?ref=${context.branch}`,
    )

    if (!Array.isArray(entries)) return []

    const files: string[] = []
    for (const entry of entries) {
      if (!entry.name || !entry.type) continue

      const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name

      if (entry.type === 'file') {
        // Skip the meta file
        if (entry.name === META_FILENAME) continue
        files.push(entryRelative)
      } else if (entry.type === 'dir') {
        // Recurse into subdirectories
        const subFiles = await listFilesRecursive(context, basePath, entryRelative)
        files.push(...subFiles)
      }
    }

    return files
  } catch (error) {
    if (isNotFoundError(error)) return []
    throw error
  }
}

/**
 * Read a single file from the GitHub backup repository.
 * Returns the file content as a Uint8Array, or null if not found.
 */
export async function readGitHubBackupFile(
  context: GitHubBackupContext,
  ownerHandle: string,
  slug: string,
  filePath: string,
): Promise<Uint8Array | null> {
  const skillRoot = buildSkillRoot(context.root, ownerHandle, slug)
  const fullPath = `${skillRoot}/${filePath}`

  try {
    const response = await githubGet<GitHubBlobResponse>(
      context.token,
      `/repos/${context.repoOwner}/${context.repoName}/contents/${encodePath(fullPath)}?ref=${context.branch}`,
    )

    if (!response.content) return null

    if (response.encoding && response.encoding !== 'base64') {
      throw new Error(`Unsupported GitHub content encoding: ${response.encoding}`)
    }

    return fromBase64Bytes(response.content)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

function buildSkillRoot(root: string, ownerHandle: string, slug: string) {
  const ownerSegment = normalizeOwner(ownerHandle)
  return `${root}/${ownerSegment}/${slug}`
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

function encodePath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function fromBase64Bytes(value: string) {
  // GitHub may include newlines in the base64 payload.
  const normalized = value.replace(/\s/g, '')
  return new Uint8Array(Buffer.from(normalized, 'base64'))
}

async function githubGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
    },
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`GitHub GET ${path} failed: ${message}`)
  }
  return (await response.json()) as T
}

function isNotFoundError(error: unknown) {
  return (
    error instanceof Error && (error.message.includes('404') || error.message.includes('Not Found'))
  )
}
