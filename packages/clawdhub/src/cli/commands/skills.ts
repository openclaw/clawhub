import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ApiRoutes,
  ApiSearchResponseSchema,
  ApiSkillMetaResponseSchema,
  ApiSkillResolveResponseSchema,
} from 'clawdhub-schema'
import semver from 'semver'
import { apiRequest, downloadZip } from '../../http.js'
import {
  extractZipToDir,
  hashSkillFiles,
  listTextFiles,
  readLockfile,
  writeLockfile,
} from '../../skills.js'
import { getRegistry } from '../registry.js'
import type { GlobalOpts, ResolveResult } from '../types.js'
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from '../ui.js'

export async function cmdSearch(opts: GlobalOpts, query: string, limit?: number) {
  if (!query) fail('Query required')

  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner('Searching')
  try {
    const url = new URL(ApiRoutes.search, registry)
    url.searchParams.set('q', query)
    if (typeof limit === 'number' && Number.isFinite(limit)) {
      url.searchParams.set('limit', String(limit))
    }
    const result = await apiRequest(
      registry,
      { method: 'GET', url: url.toString() },
      ApiSearchResponseSchema,
    )

    spinner.stop()
    for (const entry of result.results) {
      const slug = entry.slug ?? 'unknown'
      const name = entry.displayName ?? slug
      const version = entry.version ? ` v${entry.version}` : ''
      console.log(`${slug}${version}  ${name}  (${entry.score.toFixed(3)})`)
    }
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

export async function cmdInstall(
  opts: GlobalOpts,
  slug: string,
  versionFlag?: string,
  force = false,
) {
  const trimmed = slug.trim()
  if (!trimmed) fail('Slug required')

  const registry = await getRegistry(opts, { cache: true })
  await mkdir(opts.dir, { recursive: true })
  const target = join(opts.dir, trimmed)
  if (!force) {
    const exists = await fileExists(target)
    if (exists) fail(`Already installed: ${target} (use --force)`)
  } else {
    await rm(target, { recursive: true, force: true })
  }

  const spinner = createSpinner(`Resolving ${trimmed}`)
  try {
    const resolvedVersion =
      versionFlag ??
      (
        await apiRequest(
          registry,
          { method: 'GET', path: `/api/skill?slug=${encodeURIComponent(trimmed)}` },
          ApiSkillMetaResponseSchema,
        )
      ).latestVersion?.version ??
      null
    if (!resolvedVersion) fail('Could not resolve latest version')

    spinner.text = `Downloading ${trimmed}@${resolvedVersion}`
    const zip = await downloadZip(registry, { slug: trimmed, version: resolvedVersion })
    await extractZipToDir(zip, target)

    const lock = await readLockfile(opts.workdir)
    lock.skills[trimmed] = {
      version: resolvedVersion,
      installedAt: Date.now(),
    }
    await writeLockfile(opts.workdir, lock)
    spinner.succeed(`OK. Installed ${trimmed} -> ${target}`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

export async function cmdUpdate(
  opts: GlobalOpts,
  slugArg: string | undefined,
  options: { all?: boolean; version?: string; force?: boolean },
  inputAllowed: boolean,
) {
  const slug = slugArg?.trim()
  const all = Boolean(options.all)
  if (!slug && !all) fail('Provide <slug> or --all')
  if (slug && all) fail('Use either <slug> or --all')
  if (options.version && !slug) fail('--version requires a single <slug>')
  if (options.version && !semver.valid(options.version)) fail('--version must be valid semver')
  const allowPrompt = isInteractive() && inputAllowed !== false

  const registry = await getRegistry(opts, { cache: true })
  const lock = await readLockfile(opts.workdir)
  const slugs = slug ? [slug] : Object.keys(lock.skills)
  if (slugs.length === 0) {
    console.log('No installed skills.')
    return
  }

  for (const entry of slugs) {
    const spinner = createSpinner(`Checking ${entry}`)
    try {
      const target = join(opts.dir, entry)
      const exists = await fileExists(target)

      let localFingerprint: string | null = null
      if (exists) {
        const filesOnDisk = await listTextFiles(target)
        if (filesOnDisk.length > 0) {
          const hashed = hashSkillFiles(filesOnDisk)
          localFingerprint = hashed.fingerprint
        }
      }

      let resolveResult: ResolveResult
      if (localFingerprint) {
        resolveResult = await resolveSkillVersion(registry, entry, localFingerprint)
      } else {
        const url = new URL(ApiRoutes.skill, registry)
        url.searchParams.set('slug', entry)
        const meta = await apiRequest(
          registry,
          { method: 'GET', url: url.toString() },
          ApiSkillMetaResponseSchema,
        )
        resolveResult = { match: null, latestVersion: meta.latestVersion ?? null }
      }

      const latest = resolveResult.latestVersion?.version ?? null
      const matched = resolveResult.match?.version ?? null

      if (matched && lock.skills[entry]?.version !== matched) {
        lock.skills[entry] = {
          version: matched,
          installedAt: lock.skills[entry]?.installedAt ?? Date.now(),
        }
      }

      if (!latest) {
        spinner.fail(`${entry}: not found`)
        continue
      }

      if (!matched && localFingerprint && !options.force) {
        spinner.stop()
        if (!allowPrompt) {
          console.log(`${entry}: local changes (no match). Use --force to overwrite.`)
          continue
        }
        const confirm = await promptConfirm(
          `${entry}: local changes (no match). Overwrite with ${options.version ?? latest}?`,
        )
        if (!confirm) {
          console.log(`${entry}: skipped`)
          continue
        }
        spinner.start(`Updating ${entry} -> ${options.version ?? latest}`)
      }

      const targetVersion = options.version ?? latest
      if (options.version) {
        if (matched && matched === targetVersion) {
          spinner.succeed(`${entry}: already at ${matched}`)
          continue
        }
      } else if (matched && semver.valid(matched) && semver.gte(matched, targetVersion)) {
        spinner.succeed(`${entry}: up to date (${matched})`)
        continue
      }

      if (spinner.isSpinning) {
        spinner.text = `Updating ${entry} -> ${targetVersion}`
      } else {
        spinner.start(`Updating ${entry} -> ${targetVersion}`)
      }
      await rm(target, { recursive: true, force: true })
      const zip = await downloadZip(registry, { slug: entry, version: targetVersion })
      await extractZipToDir(zip, target)
      lock.skills[entry] = { version: targetVersion, installedAt: Date.now() }
      spinner.succeed(`${entry}: updated -> ${targetVersion}`)
    } catch (error) {
      spinner.fail(formatError(error))
      throw error
    }
  }

  await writeLockfile(opts.workdir, lock)
}

export async function cmdList(opts: GlobalOpts) {
  const lock = await readLockfile(opts.workdir)
  const entries = Object.entries(lock.skills)
  if (entries.length === 0) {
    console.log('No installed skills.')
    return
  }
  for (const [slug, entry] of entries) {
    console.log(`${slug}  ${entry.version ?? 'latest'}`)
  }
}

async function resolveSkillVersion(registry: string, slug: string, hash: string) {
  const url = new URL(ApiRoutes.skillResolve, registry)
  url.searchParams.set('slug', slug)
  url.searchParams.set('hash', hash)
  return apiRequest(registry, { method: 'GET', url: url.toString() }, ApiSkillResolveResponseSchema)
}

async function fileExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
