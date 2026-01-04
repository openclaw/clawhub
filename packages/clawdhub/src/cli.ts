#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { stdin } from 'node:process'
import { confirm, isCancel } from '@clack/prompts'
import {
  ApiCliPublishResponseSchema,
  ApiCliUploadUrlResponseSchema,
  ApiCliWhoamiResponseSchema,
  ApiRoutes,
  ApiSearchResponseSchema,
  ApiSkillMetaResponseSchema,
  ApiSkillResolveResponseSchema,
  ApiUploadFileResponseSchema,
  CliPublishRequestSchema,
  parseArk,
} from '@clawdhub/schema'
import { Command } from 'commander'
import ora from 'ora'
import semver from 'semver'
import { buildCliAuthUrl, startLoopbackAuthServer } from './browserAuth.js'
import { readGlobalConfig, writeGlobalConfig } from './config.js'
import { discoverRegistryFromSite } from './discovery.js'
import { apiRequest, downloadZip } from './http.js'
import {
  extractZipToDir,
  hashSkillFiles,
  listTextFiles,
  readLockfile,
  sha256Hex,
  writeLockfile,
} from './skills.js'

type GlobalOpts = {
  workdir: string
  dir: string
  site: string
  registry: string
}

type ResolveResult = {
  match: { version: string } | null
  latestVersion: { version: string } | null
}

const DEFAULT_SITE = 'https://clawdhub.com'
const DEFAULT_REGISTRY = 'https://clawdhub.com'

const program = new Command()
  .name('clawdhub')
  .description('ClawdHub CLI — install, update, search, and publish agent skills.')
  .option('--workdir <dir>', 'Working directory (default: cwd)')
  .option('--dir <dir>', 'Skills directory (relative to workdir, default: skills)')
  .option('--site <url>', 'Site base URL (for browser login)')
  .option('--registry <url>', 'Registry API base URL')
  .option('--no-input', 'Disable prompts')
  .showHelpAfterError()
  .showSuggestionAfterError()
  .addHelpText('after', '\nEnv:\n  CLAWDHUB_SITE\n  CLAWDHUB_REGISTRY\n')

program
  .command('login')
  .description('Log in (opens browser or stores token)')
  .option('--token <token>', 'API token')
  .option('--label <label>', 'Token label (browser flow only)', 'CLI token')
  .option('--no-browser', 'Do not open browser (requires --token)')
  .action(async (options) => {
    const opts = resolveGlobalOpts()
    await cmdLoginFlow(opts, options)
  })

program
  .command('logout')
  .description('Remove stored token')
  .action(async () => {
    const opts = resolveGlobalOpts()
    await cmdLogout(opts)
  })

program
  .command('whoami')
  .description('Validate token')
  .action(async () => {
    const opts = resolveGlobalOpts()
    await cmdWhoami(opts)
  })

const auth = program
  .command('auth')
  .description('Authentication commands')
  .showHelpAfterError()
  .showSuggestionAfterError()

auth
  .command('login')
  .description('Log in (opens browser or stores token)')
  .option('--token <token>', 'API token')
  .option('--label <label>', 'Token label (browser flow only)', 'CLI token')
  .option('--no-browser', 'Do not open browser (requires --token)')
  .action(async (options) => {
    const opts = resolveGlobalOpts()
    await cmdLoginFlow(opts, options)
  })

auth
  .command('logout')
  .description('Remove stored token')
  .action(async () => {
    const opts = resolveGlobalOpts()
    await cmdLogout(opts)
  })

auth
  .command('whoami')
  .description('Validate token')
  .action(async () => {
    const opts = resolveGlobalOpts()
    await cmdWhoami(opts)
  })

program
  .command('search')
  .description('Vector search skills')
  .argument('<query...>', 'Query string')
  .option('--limit <n>', 'Max results', (value) => Number.parseInt(value, 10))
  .action(async (queryParts, options) => {
    const opts = resolveGlobalOpts()
    const query = queryParts.join(' ').trim()
    await cmdSearch(opts, query, options.limit)
  })

program
  .command('install')
  .description('Install into <dir>/<slug>')
  .argument('<slug>', 'Skill slug')
  .option('--version <version>', 'Version to install')
  .option('--force', 'Overwrite existing folder')
  .action(async (slug, options) => {
    const opts = resolveGlobalOpts()
    await cmdInstall(opts, slug, options.version, options.force)
  })

program
  .command('update')
  .description('Update installed skills')
  .argument('[slug]', 'Skill slug')
  .option('--all', 'Update all installed skills')
  .option('--version <version>', 'Update to specific version (single slug only)')
  .option('--force', 'Overwrite when local files do not match any version')
  .action(async (slug, options) => {
    const opts = resolveGlobalOpts()
    await cmdUpdate(opts, slug, options)
  })

program
  .command('list')
  .description('List installed skills (from lockfile)')
  .action(async () => {
    const opts = resolveGlobalOpts()
    await cmdList(opts)
  })

program
  .command('publish')
  .description('Publish skill from folder')
  .argument('<path>', 'Skill folder path')
  .option('--slug <slug>', 'Skill slug')
  .option('--name <name>', 'Display name')
  .option('--version <version>', 'Version (semver)')
  .option('--changelog <text>', 'Changelog text')
  .option('--tags <tags>', 'Comma-separated tags', 'latest')
  .action(async (folder, options) => {
    const opts = resolveGlobalOpts()
    await cmdPublish(opts, folder, options)
  })

void program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  fail(message)
})

function resolveGlobalOpts(): GlobalOpts {
  const raw = program.opts<{ workdir?: string; dir?: string; site?: string; registry?: string }>()
  const workdir = resolve(raw.workdir ?? process.cwd())
  const dir = resolve(workdir, raw.dir ?? 'skills')
  const site = raw.site ?? process.env.CLAWDHUB_SITE ?? DEFAULT_SITE
  const registry = raw.registry ?? process.env.CLAWDHUB_REGISTRY ?? DEFAULT_REGISTRY
  return { workdir, dir, site, registry }
}

async function cmdLoginFlow(
  opts: GlobalOpts,
  options: { token?: string; label?: string; browser?: boolean },
) {
  if (options.token) {
    await cmdLogin(opts, options.token)
    return
  }

  if (options.browser === false) {
    fail('Token required (use --token or remove --no-browser)')
  }

  const label = String(options.label ?? 'CLI token').trim() || 'CLI token'
  const receiver = await startLoopbackAuthServer()
  const discovery = await discoverRegistryFromSite(opts.site).catch(() => null)
  const authBase = discovery?.authBase?.trim() || opts.site
  const authUrl = buildCliAuthUrl({
    siteUrl: authBase,
    redirectUri: receiver.redirectUri,
    label,
    state: receiver.state,
  })

  console.log(`Opening browser: ${authUrl}`)
  openInBrowser(authUrl)

  const result = await receiver.waitForResult()
  const registry = result.registry?.trim() || opts.registry
  await cmdLogin({ ...opts, registry }, result.token)
}

async function cmdLogin(opts: GlobalOpts, tokenFlag?: string) {
  const globalFlags = program.opts<{ input?: boolean }>()
  const inputAllowed = globalFlags.input !== false
  if (!tokenFlag && !inputAllowed) fail('Token required (use --token or remove --no-input)')

  const token = tokenFlag || (await promptHidden('ClawdHub token: '))
  if (!token) fail('Token required')

  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner('Verifying token')
  try {
    const whoami = await apiRequest(
      registry,
      { method: 'GET', path: ApiRoutes.cliWhoami, token },
      ApiCliWhoamiResponseSchema,
    )
    if (!whoami.user) fail('Login failed')

    await writeGlobalConfig({ registry, token })
    const handle = whoami.user.handle ? `@${whoami.user.handle}` : 'unknown user'
    spinner.succeed(`OK. Logged in as ${handle}.`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

async function cmdLogout(opts: GlobalOpts) {
  const cfg = await readGlobalConfig()
  const registry = cfg?.registry || (await getRegistry(opts, { cache: true }))
  await writeGlobalConfig({ registry, token: undefined })
  console.log('OK. Logged out.')
}

async function cmdWhoami(opts: GlobalOpts) {
  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawdhub login')
  const registry = await getRegistry(opts, { cache: true })

  const spinner = createSpinner('Checking token')
  try {
    const whoami = await apiRequest(
      registry,
      { method: 'GET', path: ApiRoutes.cliWhoami, token },
      ApiCliWhoamiResponseSchema,
    )
    spinner.succeed(whoami.user.handle ?? 'unknown')
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

async function cmdSearch(opts: GlobalOpts, query: string, limit?: number) {
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

async function cmdInstall(opts: GlobalOpts, slug: string, versionFlag?: string, force = false) {
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

async function cmdUpdate(
  opts: GlobalOpts,
  slugArg: string | undefined,
  options: { all?: boolean; version?: string; force?: boolean; input?: boolean },
) {
  const slug = slugArg?.trim()
  const all = Boolean(options.all)
  if (!slug && !all) fail('Provide <slug> or --all')
  if (slug && all) fail('Use either <slug> or --all')
  if (options.version && !slug) fail('--version requires a single <slug>')
  if (options.version && !semver.valid(options.version)) fail('--version must be valid semver')
  const globalFlags = program.opts<{ input?: boolean }>()
  const inputAllowed = options.input ?? globalFlags.input
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

async function cmdList(opts: GlobalOpts) {
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

async function cmdPublish(
  opts: GlobalOpts,
  folderArg: string,
  options: { slug?: string; name?: string; version?: string; changelog?: string; tags?: string },
) {
  const folder = folderArg ? resolve(opts.workdir, folderArg) : null
  if (!folder) fail('Path required')
  const folderStat = await stat(folder).catch(() => null)
  if (!folderStat || !folderStat.isDirectory()) fail('Path must be a folder')

  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawdhub login')
  const registry = await getRegistry(opts, { cache: true })

  const slug = options.slug ?? sanitizeSlug(basename(folder))
  const displayName = options.name ?? titleCase(basename(folder))
  const version = options.version
  const changelog = options.changelog ?? ''
  const tagsValue = options.tags ?? 'latest'
  const tags = tagsValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

  if (!slug) fail('--slug required')
  if (!displayName) fail('--name required')
  if (!version || !semver.valid(version)) fail('--version must be valid semver')

  const spinner = createSpinner(`Preparing ${slug}@${version}`)
  try {
    const meta = await apiRequest(
      registry,
      { method: 'GET', path: `/api/skill?slug=${encodeURIComponent(slug)}` },
      ApiSkillMetaResponseSchema,
    ).catch(() => null)
    const exists = Boolean(meta?.skill)
    if (exists && !changelog.trim()) fail('--changelog required for updates')

    const filesOnDisk = await listTextFiles(folder)
    if (filesOnDisk.length === 0) fail('No files found')
    if (
      !filesOnDisk.some((file) => {
        const lower = file.relPath.toLowerCase()
        return lower === 'skill.md' || lower === 'skills.md'
      })
    ) {
      fail('SKILL.md required')
    }

    const uploaded: Array<{
      path: string
      size: number
      storageId: string
      sha256: string
      contentType?: string
    }> = []

    let index = 0
    for (const file of filesOnDisk) {
      index += 1
      spinner.text = `Uploading ${file.relPath} (${index}/${filesOnDisk.length})`
      const { uploadUrl } = await apiRequest(
        registry,
        { method: 'POST', path: ApiRoutes.cliUploadUrl, token },
        ApiCliUploadUrlResponseSchema,
      )

      const storageId = await uploadFile(uploadUrl, file.bytes, file.contentType ?? 'text/plain')
      const sha256 = sha256Hex(file.bytes)
      uploaded.push({
        path: file.relPath,
        size: file.bytes.byteLength,
        storageId,
        sha256,
        contentType: file.contentType ?? undefined,
      })
    }

    spinner.text = `Publishing ${slug}@${version}`
    const body = parseArk(
      CliPublishRequestSchema,
      { slug, displayName, version, changelog, tags, files: uploaded },
      'Publish payload',
    )
    const result = await apiRequest(
      registry,
      { method: 'POST', path: ApiRoutes.cliPublish, token, body },
      ApiCliPublishResponseSchema,
    )

    spinner.succeed(`OK. Published ${slug}@${version} (${result.versionId})`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

async function resolveSkillVersion(registry: string, slug: string, hash: string) {
  const url = new URL(ApiRoutes.skillResolve, registry)
  url.searchParams.set('slug', slug)
  url.searchParams.set('hash', hash)
  return apiRequest(registry, { method: 'GET', url: url.toString() }, ApiSkillResolveResponseSchema)
}

async function uploadFile(uploadUrl: string, bytes: Uint8Array, contentType: string) {
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: Buffer.from(bytes),
  })
  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`)
  }
  const payload = parseArk(
    ApiUploadFileResponseSchema,
    (await response.json()) as unknown,
    'Upload response',
  )
  return payload.storageId
}

function sanitizeSlug(value: string) {
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
  const cleaned = raw.replace(/^-+/, '').replace(/-+$/, '').replace(/--+/g, '-')
  return cleaned
}

function titleCase(value: string) {
  return value
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

async function resolveRegistry(opts: GlobalOpts) {
  const cfg = await readGlobalConfig()
  if (cfg?.registry && cfg.registry !== DEFAULT_REGISTRY) return cfg.registry

  const explicit = opts.registry.trim()
  if (explicit && explicit !== DEFAULT_REGISTRY) return explicit

  const discovery = await discoverRegistryFromSite(opts.site).catch(() => null)
  const discovered = discovery?.apiBase?.trim()
  return discovered || explicit || DEFAULT_REGISTRY
}

async function getRegistry(opts: GlobalOpts, params?: { cache?: boolean }) {
  const cache = params?.cache !== false
  const registry = await resolveRegistry(opts)
  if (!cache) return registry
  const cfg = await readGlobalConfig()
  if (!cfg || !cfg.registry || cfg.registry === DEFAULT_REGISTRY) {
    await writeGlobalConfig({ registry, token: cfg?.token })
  }
  return registry
}

async function fileExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function promptHidden(prompt: string) {
  if (!stdin.isTTY) return ''
  process.stdout.write(prompt)
  const chunks: Buffer[] = []
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise<string>((resolvePromise) => {
    function onData(data: Buffer) {
      const text = data.toString('utf8')
      if (text === '\r' || text === '\n') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolvePromise(Buffer.concat(chunks).toString('utf8').trim())
        return
      }
      if (text === '\u0003') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        fail('Canceled')
      }
      if (text === '\u007f') {
        chunks.pop()
        return
      }
      chunks.push(data)
    }
    stdin.on('data', onData)
  })
}

async function promptConfirm(prompt: string) {
  const answer = await confirm({ message: prompt })
  if (isCancel(answer)) return false
  return Boolean(answer)
}

function openInBrowser(url: string) {
  const args =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  const [command, ...commandArgs] = args
  if (!command) return
  const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true })
  child.unref()
}

function isInteractive() {
  return Boolean(process.stdout.isTTY && stdin.isTTY)
}

function createSpinner(text: string) {
  return ora({ text, spinner: 'dots', isEnabled: isInteractive() }).start()
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}
