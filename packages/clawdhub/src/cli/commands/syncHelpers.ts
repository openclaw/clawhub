import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { isCancel, multiselect } from '@clack/prompts'
import semver from 'semver'
import { apiRequest, downloadZip } from '../../http.js'
import {
  ApiCliTelemetrySyncResponseSchema,
  ApiRoutes,
  ApiV1SkillResolveResponseSchema,
  ApiV1SkillResponseSchema,
  ApiV1WhoamiResponseSchema,
  LegacyApiRoutes,
} from '../../schema/index.js'
import { hashSkillZip } from '../../skills.js'
import { getRegistry } from '../registry.js'
import { findSkillFolders, type SkillFolder } from '../scanSkills.js'
import type { GlobalOpts } from '../types.js'
import { fail, formatError } from '../ui.js'
import type { Candidate, LocalSkill } from './syncTypes.js'

export async function reportTelemetryIfEnabled(params: {
  token: string
  registry: string
  scan: { roots: string[]; skillsByRoot: Record<string, SkillFolder[]> }
  candidates: Candidate[]
}) {
  if (isTelemetryDisabled()) return
  const versionBySlug = new Map<string, string | null>()
  for (const candidate of params.candidates) {
    versionBySlug.set(candidate.slug, candidate.matchVersion ?? null)
  }

  const roots = params.scan.roots.map((root) => ({
    rootId: rootTelemetryId(root),
    label: formatRootLabel(root),
    skills: (params.scan.skillsByRoot[root] ?? []).map((skill) => ({
      slug: skill.slug,
      version: versionBySlug.get(skill.slug) ?? null,
    })),
  }))

  try {
    await apiRequest(
      params.registry,
      {
        method: 'POST',
        path: LegacyApiRoutes.cliTelemetrySync,
        token: params.token,
        body: { roots },
      },
      ApiCliTelemetrySyncResponseSchema,
    )
  } catch {
    // ignore telemetry failures
  }
}

function isTelemetryDisabled() {
  const raw = process.env.CLAWHUB_DISABLE_TELEMETRY ?? process.env.CLAWDHUB_DISABLE_TELEMETRY
  if (!raw) return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

export function buildScanRoots(opts: GlobalOpts, extraRoots: string[] | undefined) {
  const roots = [opts.workdir, opts.dir, ...(extraRoots ?? [])]
  return Array.from(new Set(roots.map((root) => resolve(root))))
}

export function normalizeConcurrency(value: number | undefined) {
  const raw = typeof value === 'number' ? value : 4
  const rounded = Number.isFinite(raw) ? Math.round(raw) : 4
  return Math.min(32, Math.max(1, rounded))
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
) {
  const results = Array.from({ length: items.length }) as R[]
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, limit), items.length || 1)

  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await fn(items[index] as T)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

export async function checkRegistrySyncState(
  registry: string,
  skill: LocalSkill,
  resolveSupport: { value: boolean | null },
  token?: string,
): Promise<Candidate> {
  if (resolveSupport.value !== false) {
    try {
      const resolved = await apiRequest(
        registry,
        {
          method: 'GET',
          path: `${ApiRoutes.resolve}?slug=${encodeURIComponent(skill.slug)}&hash=${encodeURIComponent(skill.fingerprint)}`,
          token,
        },
        ApiV1SkillResolveResponseSchema,
      )
      resolveSupport.value = true
      const latestVersion = resolved.latestVersion?.version ?? null
      const matchVersion = resolved.match?.version ?? null
      if (!latestVersion) {
        return {
          ...skill,
          status: 'new',
          matchVersion: null,
          latestVersion: null,
        }
      }
      return {
        ...skill,
        status: matchVersion ? 'synced' : 'update',
        matchVersion,
        latestVersion,
      }
    } catch (error) {
      const message = formatError(error)
      if (/skill not found/i.test(message) || /HTTP 404/i.test(message)) {
        resolveSupport.value = true
        return {
          ...skill,
          status: 'new',
          matchVersion: null,
          latestVersion: null,
        }
      }
      if (/no matching routes found/i.test(message)) {
        resolveSupport.value = false
      } else {
        throw error
      }
    }
  }

  const meta = await apiRequest(
    registry,
    { method: 'GET', path: `${ApiRoutes.skills}/${encodeURIComponent(skill.slug)}`, token },
    ApiV1SkillResponseSchema,
  ).catch(() => null)

  const latestVersion = meta?.latestVersion?.version ?? null
  if (!latestVersion) {
    return {
      ...skill,
      status: 'new',
      matchVersion: null,
      latestVersion: null,
    }
  }

  const zip = await downloadZip(registry, { slug: skill.slug, version: latestVersion, token })
  const remote = hashSkillZip(zip).fingerprint
  const matchVersion = remote === skill.fingerprint ? latestVersion : null

  return {
    ...skill,
    status: matchVersion ? 'synced' : 'update',
    matchVersion,
    latestVersion,
  }
}

export async function scanRoots(roots: string[]) {
  const result = await scanRootsWithLabels(roots)
  return {
    roots: result.roots,
    skillsByRoot: result.skillsByRoot,
    skills: result.skills,
    rootsWithSkills: result.rootsWithSkills,
  }
}

export async function scanRootsWithLabels(roots: string[], labels?: Record<string, string>) {
  const all: SkillFolder[] = []
  const rootsWithSkills: string[] = []
  const uniqueRoots = await dedupeRoots(roots)
  const skillsByRoot: Record<string, SkillFolder[]> = {}
  const rootLabels: Record<string, string> = {}
  for (const root of uniqueRoots) {
    const found = await findSkillFolders(root)
    skillsByRoot[root] = found
    if (found.length > 0) rootsWithSkills.push(root)
    all.push(...found)
    if (labels?.[root]) rootLabels[root] = labels[root] as string
  }
  const byFolder = new Map<string, SkillFolder>()
  for (const folder of all) {
    byFolder.set(folder.folder, folder)
  }
  return {
    roots: uniqueRoots,
    skillsByRoot,
    skills: Array.from(byFolder.values()),
    rootsWithSkills,
    rootLabels,
  }
}

export function mergeScan(
  left: {
    roots: string[]
    skillsByRoot: Record<string, SkillFolder[]>
    skills: SkillFolder[]
    rootsWithSkills: string[]
    rootLabels: Record<string, string>
  },
  right: {
    roots: string[]
    skillsByRoot: Record<string, SkillFolder[]>
    skills: SkillFolder[]
    rootsWithSkills: string[]
    rootLabels: Record<string, string>
  },
) {
  const mergedRoots = Array.from(new Set([...left.roots, ...right.roots]))
  const skillsByRoot: Record<string, SkillFolder[]> = {}
  for (const root of mergedRoots) {
    skillsByRoot[root] = right.skillsByRoot[root] ?? left.skillsByRoot[root] ?? []
  }
  const rootLabels: Record<string, string> = { ...left.rootLabels, ...right.rootLabels }
  const byFolder = new Map<string, SkillFolder>()
  for (const entry of [...left.skills, ...right.skills]) {
    byFolder.set(entry.folder, entry)
  }
  const skills = Array.from(byFolder.values())
  const rootsWithSkills = mergedRoots.filter((root) => (skillsByRoot[root]?.length ?? 0) > 0)
  return { roots: mergedRoots, skillsByRoot, skills, rootsWithSkills, rootLabels }
}

async function dedupeRoots(roots: string[]) {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const root of roots) {
    const resolved = resolve(root)
    const canonical = await realpath(resolved).catch(() => null)
    const key = canonical ?? resolved
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(key)
  }
  return unique
}

export async function selectToUpload(
  candidates: Candidate[],
  params: { allowPrompt: boolean; all: boolean; bump: 'patch' | 'minor' | 'major' },
): Promise<Candidate[]> {
  if (params.all || !params.allowPrompt) return candidates

  const valueByKey = new Map<string, Candidate>()
  const choices = candidates.map((candidate) => {
    const key = candidate.folder
    valueByKey.set(key, candidate)
    return {
      value: key,
      label: `${candidate.slug}  ${formatActionableStatus(candidate, params.bump)}`,
      hint: `${abbreviatePath(candidate.folder)} | ${candidate.fileCount} files`,
    }
  })

  const picked = await multiselect({
    message: 'Select skills to upload',
    options: choices,
    initialValues: choices.map((choice) => choice.value),
    required: false,
  })
  if (isCancel(picked)) fail('Canceled')
  const selected = picked.map((key) => valueByKey.get(String(key))).filter(Boolean) as Candidate[]
  return selected
}

export async function resolvePublishMeta(
  skill: Candidate,
  params: { bump: 'patch' | 'minor' | 'major'; allowPrompt: boolean; changelogFlag?: string },
) {
  if (skill.status === 'new') {
    return { publishVersion: '1.0.0', changelog: '' }
  }

  const latest = skill.latestVersion
  if (!latest) fail(`Could not resolve latest version for ${skill.slug}`)
  const publishVersion = semver.inc(latest, params.bump)
  if (!publishVersion) fail(`Could not bump version for ${skill.slug}`)

  const fromFlag = params.changelogFlag?.trim()
  if (fromFlag) return { publishVersion, changelog: fromFlag }

  return { publishVersion, changelog: '' }
}

export async function getRegistryWithAuth(opts: GlobalOpts, token: string) {
  const registry = await getRegistry(opts, { cache: true })
  await apiRequest(
    registry,
    { method: 'GET', path: ApiRoutes.whoami, token },
    ApiV1WhoamiResponseSchema,
  )
  return registry
}

export function formatList(values: string[], max: number) {
  if (values.length === 0) return ''
  const shown = values.map(abbreviatePath)
  if (shown.length <= max) return shown.join('\n')
  const head = shown.slice(0, Math.max(1, max - 1))
  const rest = values.length - head.length
  return [...head, `… +${rest} more`].join('\n')
}

export function printSection(title: string, body?: string) {
  const trimmed = body?.trim()
  if (!trimmed) {
    console.log(title)
    return
  }
  if (trimmed.includes('\n')) {
    console.log(`\n${title}\n${trimmed}`)
    return
  }
  console.log(`${title}: ${trimmed}`)
}

function abbreviatePath(value: string) {
  const home = homedir()
  if (value.startsWith(home)) return `~${value.slice(home.length)}`
  return value
}

function rootTelemetryId(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function formatRootLabel(value: string) {
  const home = homedir()
  if (value === home) return '~'

  const normalized = value.replaceAll('\\', '/')
  const normalizedHome = home.replaceAll('\\', '/')
  const isHome = normalized === normalizedHome || normalized.startsWith(`${normalizedHome}/`)

  const stripped = isHome ? normalized.slice(normalizedHome.length).replace(/^\//, '') : normalized
  const parts = stripped.split('/').filter(Boolean)
  const tail = parts.slice(-2).join('/')

  if (!tail) return isHome ? '~' : '…'
  return isHome ? `~/${tail}` : `…/${tail}`
}

export function dedupeSkillsBySlug(skills: SkillFolder[]) {
  const bySlug = new Map<string, SkillFolder[]>()
  for (const skill of skills) {
    const existing = bySlug.get(skill.slug)
    if (existing) existing.push(skill)
    else bySlug.set(skill.slug, [skill])
  }
  const unique: SkillFolder[] = []
  const duplicates: string[] = []
  for (const [slug, entries] of bySlug.entries()) {
    unique.push(entries[0] as SkillFolder)
    if (entries.length > 1) duplicates.push(`${slug} (${entries.length})`)
  }
  return { skills: unique, duplicates }
}

export function formatActionableStatus(
  candidate: Candidate,
  bump: 'patch' | 'minor' | 'major',
): string {
  if (candidate.status === 'new') return 'NEW'
  const latest = candidate.latestVersion
  const next = latest ? semver.inc(latest, bump) : null
  if (latest && next) return `UPDATE ${latest} → ${next}`
  return 'UPDATE'
}

export function formatActionableLine(
  candidate: Candidate,
  bump: 'patch' | 'minor' | 'major',
): string {
  return `${candidate.slug}  ${formatActionableStatus(candidate, bump)}  (${candidate.fileCount} files)`
}

function formatSyncedLine(candidate: Candidate): string {
  const version = candidate.matchVersion ?? candidate.latestVersion ?? 'unknown'
  return `${candidate.slug}  synced (${version})`
}

export function formatSyncedSummary(candidate: Candidate): string {
  const version = candidate.matchVersion ?? candidate.latestVersion
  return version ? `${candidate.slug}@${version}` : candidate.slug
}

export function formatBulletList(lines: string[], max: number): string {
  if (lines.length <= max) return lines.map((line) => `- ${line}`).join('\n')
  const head = lines.slice(0, max)
  const rest = lines.length - head.length
  return [...head, `... +${rest} more`].map((line) => `- ${line}`).join('\n')
}

export function formatSyncedDisplay(synced: Candidate[]) {
  const lines = synced.map(formatSyncedLine)
  if (lines.length <= 12) return formatBulletList(lines, 12)
  return formatCommaList(synced.map(formatSyncedSummary), 24)
}

export function formatCommaList(values: string[], max: number) {
  if (values.length === 0) return ''
  if (values.length <= max) return values.join(', ')
  const head = values.slice(0, Math.max(1, max - 1))
  const rest = values.length - head.length
  return `${head.join(', ')}, ... +${rest} more`
}
