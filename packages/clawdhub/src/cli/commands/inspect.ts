import { apiRequest, fetchText } from '../../http.js'
import {
  ApiRoutes,
  ApiV1SkillResponseSchema,
  ApiV1SkillVersionListResponseSchema,
  ApiV1SkillVersionResponseSchema,
} from '../../schema/index.js'
import { readGlobalConfig } from '../../config.js'
import { getRegistry } from '../registry.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError } from '../ui.js'

type InspectOptions = {
  version?: string
  tag?: string
  versions?: boolean
  limit?: number
  files?: boolean
  file?: string
  json?: boolean
}

type FileEntry = {
  path: string
  size: number | null
  sha256: string | null
  contentType: string | null
}

export async function cmdInspect(opts: GlobalOpts, slug: string, options: InspectOptions = {}) {
  const trimmed = slug.trim()
  if (!trimmed) fail('Slug required')
  if (options.version && options.tag) fail('Use either --version or --tag')

  const cfg = await readGlobalConfig()
  const token = cfg?.token ?? undefined

  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner('Fetching skill')
  try {
    const skillResult = await apiRequest(
      registry,
      { method: 'GET', path: `${ApiRoutes.skills}/${encodeURIComponent(trimmed)}`, token },
      ApiV1SkillResponseSchema,
    )

    if (!skillResult.skill) {
      spinner.fail('Skill not found')
      return
    }

    const skill = skillResult.skill
    const tags = normalizeTags(skill.tags)
    const latestVersion = skillResult.latestVersion?.version ?? tags.latest ?? null
    const taggedVersion = options.tag ? (tags[options.tag] ?? null) : null
    if (options.tag && !taggedVersion) {
      spinner.fail(`Unknown tag "${options.tag}"`)
      return
    }
    const requestedVersion = options.version ?? taggedVersion ?? null

    let versionResult: { version: unknown; skill: unknown } | null = null
    if (options.files || options.file || options.version || options.tag) {
      const targetVersion = requestedVersion ?? latestVersion
      if (!targetVersion) fail('Could not resolve latest version')
      spinner.text = `Fetching ${trimmed}@${targetVersion}`
      versionResult = await apiRequest(
        registry,
        {
          method: 'GET',
          path: `${ApiRoutes.skills}/${encodeURIComponent(trimmed)}/versions/${encodeURIComponent(
            targetVersion,
          )}`,
          token,
        },
        ApiV1SkillVersionResponseSchema,
      )
    }

    let versionsList: { items?: unknown[]; nextCursor?: string | null } | null = null
    if (options.versions) {
      const limit = clampLimit(options.limit ?? 25, 25)
      const url = new URL(`${ApiRoutes.skills}/${encodeURIComponent(trimmed)}/versions`, registry)
      url.searchParams.set('limit', String(limit))
      spinner.text = `Fetching versions (${limit})`
      versionsList = await apiRequest(
        registry,
        { method: 'GET', url: url.toString(), token },
        ApiV1SkillVersionListResponseSchema,
      )
    }

    let fileContent: string | null = null
    if (options.file) {
      const url = new URL(`${ApiRoutes.skills}/${encodeURIComponent(trimmed)}/file`, registry)
      url.searchParams.set('path', options.file)
      if (options.version) {
        url.searchParams.set('version', options.version)
      } else if (options.tag) {
        url.searchParams.set('tag', options.tag)
      } else if (latestVersion) {
        url.searchParams.set('version', latestVersion)
      }
      spinner.text = `Fetching ${options.file}`
      fileContent = await fetchText(registry, { url: url.toString(), token })
    }

    spinner.stop()

    const output = {
      skill: skillResult.skill,
      latestVersion: skillResult.latestVersion,
      owner: skillResult.owner,
      version: versionResult?.version ?? null,
      versions: versionsList?.items ?? null,
      file: options.file ? { path: options.file, content: fileContent } : null,
    }

    if (options.json) {
      console.log(JSON.stringify(output, null, 2))
      return
    }

    const shouldPrintMeta = !options.file || options.files || options.versions || options.version
    if (shouldPrintMeta) {
      printSkillSummary({
        skill,
        latestVersion: skillResult.latestVersion,
        owner: skillResult.owner,
      })
    }

    if (shouldPrintMeta && versionResult?.version) {
      printVersionSummary(versionResult.version)
    }

    if (versionsList?.items && Array.isArray(versionsList.items)) {
      if (versionsList.items.length === 0) {
        console.log('No versions found.')
      } else {
        console.log('Versions:')
        for (const item of versionsList.items) {
          console.log(formatVersionLine(item))
        }
      }
    }

    if (versionResult?.version) {
      const files = normalizeFiles((versionResult.version as { files?: unknown }).files)
      if (options.files) {
        if (files.length === 0) {
          console.log('No files found.')
        } else {
          console.log('Files:')
          for (const file of files) {
            console.log(formatFileLine(file))
          }
        }
      }
    }

    if (options.file && fileContent !== null) {
      if (shouldPrintMeta) console.log(`\n${options.file}:\n`)
      process.stdout.write(fileContent)
      if (!fileContent.endsWith('\n')) process.stdout.write('\n')
    }
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

function printSkillSummary(result: {
  skill: {
    slug: string
    displayName: string
    summary?: string | null
    tags?: unknown
    stats?: unknown
    createdAt: number
    updatedAt: number
  }
  latestVersion?: { version: string; createdAt: number; changelog: string } | null
  owner?: { handle?: string | null; displayName?: string | null; image?: string | null } | null
}) {
  const { skill } = result
  console.log(`${skill.slug}  ${skill.displayName}`)
  if (skill.summary) console.log(`Summary: ${skill.summary}`)
  const owner = result.owner?.handle || result.owner?.displayName
  if (owner) console.log(`Owner: ${owner}`)
  console.log(`Created: ${formatTimestamp(skill.createdAt)}`)
  console.log(`Updated: ${formatTimestamp(skill.updatedAt)}`)
  if (result.latestVersion?.version) {
    console.log(`Latest: ${result.latestVersion.version}`)
  }
  const tags = normalizeTags(skill.tags)
  const tagEntries = Object.entries(tags)
  if (tagEntries.length > 0) {
    console.log(`Tags: ${tagEntries.map(([tag, version]) => `${tag}=${version}`).join(', ')}`)
  }
}

function printVersionSummary(version: unknown) {
  if (!version || typeof version !== 'object') return
  const entry = version as { version?: unknown; createdAt?: unknown; changelog?: unknown }
  const value = typeof entry.version === 'string' ? entry.version : null
  if (!value) return
  console.log(`Selected: ${value}`)
  if (typeof entry.createdAt === 'number') {
    console.log(`Selected At: ${formatTimestamp(entry.createdAt)}`)
  }
  if (typeof entry.changelog === 'string' && entry.changelog.trim()) {
    console.log(`Changelog: ${truncate(entry.changelog, 120)}`)
  }
}

function normalizeTags(tags: unknown): Record<string, string> {
  if (!tags || typeof tags !== 'object') return {}
  const entries = Object.entries(tags as Record<string, unknown>)
  const resolved: Record<string, string> = {}
  for (const [tag, version] of entries) {
    if (typeof version === 'string') resolved[tag] = version
  }
  return resolved
}

function normalizeFiles(files: unknown): FileEntry[] {
  if (!Array.isArray(files)) return []
  return files
    .map((file) => {
      if (!file || typeof file !== 'object') return null
      const entry = file as {
        path?: unknown
        size?: unknown
        sha256?: unknown
        contentType?: unknown
      }
      if (typeof entry.path !== 'string') return null
      const size = typeof entry.size === 'number' ? entry.size : Number(entry.size)
      const sha256 = typeof entry.sha256 === 'string' ? entry.sha256 : null
      const contentType = typeof entry.contentType === 'string' ? entry.contentType : null
      return {
        path: entry.path,
        size: Number.isFinite(size) ? size : null,
        sha256,
        contentType,
      }
    })
    .filter((entry): entry is FileEntry => Boolean(entry))
}

function formatVersionLine(item: unknown) {
  if (!item || typeof item !== 'object') return '-'
  const entry = item as { version?: unknown; createdAt?: unknown; changelog?: unknown }
  const version = typeof entry.version === 'string' ? entry.version : '?'
  const createdAt =
    typeof entry.createdAt === 'number' ? formatTimestamp(entry.createdAt) : 'unknown'
  const changelog = typeof entry.changelog === 'string' ? entry.changelog : ''
  const snippet = changelog ? `  ${truncate(changelog, 80)}` : ''
  return `${version}  ${createdAt}${snippet}`
}

function formatFileLine(file: FileEntry) {
  const size = file.size === null ? '?' : formatBytes(file.size)
  const sha = file.sha256 ?? '?'
  const type = file.contentType ? `  ${file.contentType}` : ''
  return `${file.path}  ${size}  ${sha}${type}`
}

function formatTimestamp(timestamp: number) {
  if (!Number.isFinite(timestamp)) return 'unknown'
  return new Date(timestamp).toISOString()
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '?'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded}${units[index]}`
}

function clampLimit(limit: number, fallback: number) {
  if (!Number.isFinite(limit)) return fallback
  return Math.min(Math.max(1, Math.round(limit)), 200)
}

function truncate(str: string, maxLen: number) {
  if (str.length <= maxLen) return str
  return `${str.slice(0, maxLen - 3)}...`
}
