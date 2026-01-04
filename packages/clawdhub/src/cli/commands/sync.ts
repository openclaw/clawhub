import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { intro, isCancel, multiselect, note, outro, text } from '@clack/prompts'
import {
  ApiCliWhoamiResponseSchema,
  ApiRoutes,
  ApiSkillMetaResponseSchema,
  ApiSkillResolveResponseSchema,
} from 'clawdhub-schema'
import semver from 'semver'
import { readGlobalConfig } from '../../config.js'
import { apiRequest, downloadZip } from '../../http.js'
import { hashSkillFiles, hashSkillZip, listTextFiles } from '../../skills.js'
import { getRegistry } from '../registry.js'
import { findSkillFolders, getFallbackSkillRoots, type SkillFolder } from '../scanSkills.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError, isInteractive } from '../ui.js'
import { cmdPublish } from './publish.js'

type SyncOptions = {
  root?: string[]
  all?: boolean
  dryRun?: boolean
  bump?: 'patch' | 'minor' | 'major'
  changelog?: string
  tags?: string
}

type Candidate = SkillFolder & {
  fingerprint: string
  fileCount: number
  status: 'synced' | 'new' | 'update'
  matchVersion: string | null
  latestVersion: string | null
}

export async function cmdSync(opts: GlobalOpts, options: SyncOptions, inputAllowed: boolean) {
  const allowPrompt = isInteractive() && inputAllowed !== false
  intro('ClawdHub sync')

  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawdhub login')

  const registry = await getRegistryWithAuth(opts, token)
  const selectedRoots = buildScanRoots(opts, options.root)

  const spinner = createSpinner('Scanning for local skills')
  let scan = await scanRoots(selectedRoots)
  if (scan.skills.length === 0) {
    const fallback = getFallbackSkillRoots(opts.workdir)
    scan = await scanRoots(fallback)
    spinner.stop()
    if (scan.skills.length === 0)
      fail('No skills found (checked workdir and known Clawdis/Clawd locations)')
    note(
      `No skills in workdir. Found ${scan.skills.length} in legacy locations.`,
      formatList(scan.rootsWithSkills, 10),
    )
  } else {
    spinner.stop()
  }
  let skills = scan.skills

  skills = await maybeSelectLocalSkills(skills, {
    allowPrompt,
    all: Boolean(options.all),
  })
  if (skills.length === 0) {
    outro('Nothing selected.')
    return
  }

  const candidatesSpinner = createSpinner('Checking registry sync state')
  const candidates: Candidate[] = []
  let supportsResolve: boolean | null = null
  try {
    for (const skill of skills) {
      const filesOnDisk = await listTextFiles(skill.folder)
      const hashed = hashSkillFiles(filesOnDisk)
      const fingerprint = hashed.fingerprint

      const meta = await apiRequest(
        registry,
        { method: 'GET', path: `${ApiRoutes.skill}?slug=${encodeURIComponent(skill.slug)}` },
        ApiSkillMetaResponseSchema,
      ).catch(() => null)

      const latestVersion = meta?.latestVersion?.version ?? null
      if (!latestVersion) {
        candidates.push({
          ...skill,
          fingerprint,
          fileCount: filesOnDisk.length,
          status: 'new',
          matchVersion: null,
          latestVersion: null,
        })
        continue
      }

      let matchVersion: string | null = null
      if (supportsResolve !== false) {
        try {
          const resolved = await apiRequest(
            registry,
            {
              method: 'GET',
              path: `${ApiRoutes.skillResolve}?slug=${encodeURIComponent(skill.slug)}&hash=${encodeURIComponent(fingerprint)}`,
            },
            ApiSkillResolveResponseSchema,
          )
          supportsResolve = true
          matchVersion = resolved.match?.version ?? null
        } catch (error) {
          const message = formatError(error)
          if (/skill not found/i.test(message)) {
            matchVersion = null
          } else if (/no matching routes found/i.test(message) || /not found/i.test(message)) {
            supportsResolve = false
          } else {
            throw error
          }
        }
      }

      if (supportsResolve === false) {
        const zip = await downloadZip(registry, { slug: skill.slug, version: latestVersion })
        const remote = hashSkillZip(zip).fingerprint
        matchVersion = remote === fingerprint ? latestVersion : null
      }

      candidates.push({
        ...skill,
        fingerprint,
        fileCount: filesOnDisk.length,
        status: matchVersion ? 'synced' : 'update',
        matchVersion,
        latestVersion,
      })
    }
  } catch (error) {
    candidatesSpinner.fail(formatError(error))
    throw error
  } finally {
    candidatesSpinner.stop()
  }

  const synced = candidates.filter((candidate) => candidate.status === 'synced')
  if (synced.length > 0) {
    const lines = synced
      .map((candidate) => `${candidate.slug}  synced (${candidate.matchVersion ?? 'unknown'})`)
      .join('\n')
    note('Already synced', lines)
  }

  const actionable = candidates.filter((candidate) => candidate.status !== 'synced')
  if (actionable.length === 0) {
    outro('Everything is already synced.')
    return
  }

  const selected = await selectToUpload(actionable, {
    allowPrompt,
    all: Boolean(options.all),
    bump: options.bump ?? 'patch',
  })
  if (selected.length === 0) {
    outro('Nothing selected.')
    return
  }

  if (options.dryRun) {
    outro(`Dry run: would upload ${selected.length} skill(s).`)
    return
  }

  const bump = options.bump ?? 'patch'
  const tags = options.tags ?? 'latest'

  for (const skill of selected) {
    const { publishVersion, changelog } = await resolvePublishMeta(skill, {
      bump,
      allowPrompt,
      changelogFlag: options.changelog,
    })
    await cmdPublish(opts, skill.folder, {
      slug: skill.slug,
      name: skill.displayName,
      version: publishVersion,
      changelog,
      tags,
    })
  }

  outro(`Uploaded ${selected.length} skill(s).`)
}

function buildScanRoots(opts: GlobalOpts, extraRoots: string[] | undefined) {
  const roots = [opts.workdir, opts.dir, ...(extraRoots ?? [])]
  return Array.from(new Set(roots.map((root) => resolve(root))))
}

async function scanRoots(roots: string[]) {
  const all: SkillFolder[] = []
  const rootsWithSkills: string[] = []
  for (const root of roots) {
    const found = await findSkillFolders(root)
    if (found.length > 0) rootsWithSkills.push(root)
    all.push(...found)
  }
  const byFolder = new Map<string, SkillFolder>()
  for (const folder of all) {
    byFolder.set(folder.folder, folder)
  }
  return { skills: Array.from(byFolder.values()), rootsWithSkills }
}

async function maybeSelectLocalSkills(
  skills: SkillFolder[],
  params: { allowPrompt: boolean; all: boolean },
): Promise<SkillFolder[]> {
  if (params.all || !params.allowPrompt) return skills
  if (skills.length <= 30) return skills

  const valueByKey = new Map<string, SkillFolder>()
  const choices = skills.map((skill) => {
    const key = skill.folder
    valueByKey.set(key, skill)
    return {
      value: key,
      label: skill.slug,
      hint: abbreviatePath(skill.folder),
    }
  })

  const picked = await multiselect({
    message: `Found ${skills.length} local skills — select what to sync`,
    options: choices,
    initialValues: [],
    required: false,
  })
  if (isCancel(picked)) fail('Canceled')
  return picked.map((key) => valueByKey.get(String(key))).filter(Boolean) as SkillFolder[]
}

async function selectToUpload(
  candidates: Candidate[],
  params: { allowPrompt: boolean; all: boolean; bump: 'patch' | 'minor' | 'major' },
): Promise<Candidate[]> {
  if (params.all || !params.allowPrompt) return candidates

  const valueByKey = new Map<string, Candidate>()
  const choices = candidates.map((candidate) => {
    const key = candidate.folder
    valueByKey.set(key, candidate)
    const latest = candidate.latestVersion
    const next = latest ? semver.inc(latest, params.bump) : null
    const status =
      candidate.status === 'new' ? 'NEW' : latest && next ? `UPDATE ${latest} → ${next}` : 'UPDATE'
    return {
      value: key,
      label: `${candidate.slug}  ${status}`,
      hint: candidate.folder,
    }
  })

  const picked = await multiselect({
    message: 'Select skills to upload',
    options: choices,
    initialValues: candidates.length <= 10 ? choices.map((choice) => choice.value) : [],
    required: false,
  })
  if (isCancel(picked)) fail('Canceled')
  const selected = picked.map((key) => valueByKey.get(String(key))).filter(Boolean) as Candidate[]
  return selected
}

async function resolvePublishMeta(
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

  if (!params.allowPrompt) {
    return { publishVersion, changelog: 'Sync update' }
  }

  const entered = await text({
    message: `Changelog for ${skill.slug}@${publishVersion}`,
    placeholder: 'What changed?',
    defaultValue: 'Sync update',
  })
  if (isCancel(entered)) fail('Canceled')
  const changelog = String(entered ?? '').trim()
  if (!changelog) fail('--changelog required for updates')
  return { publishVersion, changelog }
}

async function getRegistryWithAuth(opts: GlobalOpts, token: string) {
  const registry = await getRegistry(opts, { cache: true })
  await apiRequest(
    registry,
    { method: 'GET', path: ApiRoutes.cliWhoami, token },
    ApiCliWhoamiResponseSchema,
  )
  return registry
}

function formatList(values: string[], max: number) {
  if (values.length === 0) return ''
  const shown = values.map(abbreviatePath)
  if (shown.length <= max) return shown.join('\n')
  const head = shown.slice(0, Math.max(1, max - 1))
  const rest = values.length - head.length
  return [...head, `… +${rest} more`].join('\n')
}

function abbreviatePath(value: string) {
  const home = homedir()
  if (value.startsWith(home)) return `~${value.slice(home.length)}`
  return value
}
