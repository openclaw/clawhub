/* @vitest-environment node */

import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ApiRoutes,
  ApiV1SearchResponseSchema,
  ApiV1WhoamiResponseSchema,
  parseArk,
} from 'clawhub-schema'
import { unzipSync } from 'fflate'
import { Agent, setGlobalDispatcher } from 'undici'
import { describe, expect, it } from 'vitest'
import { readGlobalConfig } from '../packages/clawdhub/src/config'

const REQUEST_TIMEOUT_MS = 15_000

try {
  setGlobalDispatcher(
    new Agent({
      connect: { timeout: REQUEST_TIMEOUT_MS },
    }),
  )
} catch {
  // ignore dispatcher setup failures
}

function mustGetToken() {
  const fromEnv = process.env.CLAWHUB_E2E_TOKEN?.trim() || process.env.CLAWDHUB_E2E_TOKEN?.trim()
  if (fromEnv) return fromEnv
  return null
}

function getRegistry() {
  return (
    process.env.CLAWHUB_REGISTRY?.trim() ||
    process.env.CLAWDHUB_REGISTRY?.trim() ||
    'https://clawhub.ai'
  )
}

function getSite() {
  return (
    process.env.CLAWHUB_SITE?.trim() || process.env.CLAWDHUB_SITE?.trim() || 'https://clawhub.ai'
  )
}

async function makeTempConfig(registry: string, token: string | null) {
  const dir = await mkdtemp(join(tmpdir(), 'clawhub-e2e-'))
  const path = join(dir, 'config.json')
  await writeFile(
    path,
    `${JSON.stringify({ registry, token: token || undefined }, null, 2)}\n`,
    'utf8',
  )
  return { dir, path }
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Timeout')), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

describe('clawhub e2e', () => {
  it('prints CLI version via --cli-version', async () => {
    const result = spawnSync('bun', ['clawhub', '--cli-version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('search endpoint returns a results array (schema parse)', async () => {
    const registry = getRegistry()
    const url = new URL(ApiRoutes.search, registry)
    url.searchParams.set('q', 'gif')
    url.searchParams.set('limit', '5')

    const response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json' },
    })
    expect(response.ok).toBe(true)
    const json = (await response.json()) as unknown
    const parsed = parseArk(ApiV1SearchResponseSchema, json, 'API response')
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  it('cli search does not error on multi-result responses', async () => {
    const registry = getRegistry()
    const site = getSite()
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null

    const cfg = await makeTempConfig(registry, token)
    try {
      const workdir = await mkdtemp(join(tmpdir(), 'clawhub-e2e-workdir-'))
      const result = spawnSync(
        'bun',
        [
          'clawhub',
          'search',
          'gif',
          '--limit',
          '5',
          '--site',
          site,
          '--registry',
          registry,
          '--workdir',
          workdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      await rm(workdir, { recursive: true, force: true })

      expect(result.status).toBe(0)
      expect(result.stderr).not.toMatch(/API response:/)
    } finally {
      await rm(cfg.dir, { recursive: true, force: true })
    }
  })

  it('assumes a logged-in user (whoami succeeds)', async () => {
    const registry = getRegistry()
    const site = getSite()
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null
    if (!token) {
      throw new Error('Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login')
    }

    const cfg = await makeTempConfig(registry, token)
    try {
      const whoamiUrl = new URL(ApiRoutes.whoami, registry)
      const whoamiRes = await fetchWithTimeout(whoamiUrl.toString(), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      })
      expect(whoamiRes.ok).toBe(true)
      const whoami = parseArk(
        ApiV1WhoamiResponseSchema,
        (await whoamiRes.json()) as unknown,
        'Whoami',
      )
      expect(whoami.user).toBeTruthy()

      const result = spawnSync(
        'bun',
        ['clawhub', 'whoami', '--site', site, '--registry', registry],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(result.status).toBe(0)
      expect(result.stderr).not.toMatch(/not logged in|unauthorized|error:/i)
    } finally {
      await rm(cfg.dir, { recursive: true, force: true })
    }
  })

  it('sync dry-run finds skills from an explicit root', async () => {
    const registry = getRegistry()
    const site = getSite()
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null
    if (!token) {
      throw new Error('Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login')
    }

    const cfg = await makeTempConfig(registry, token)
    const root = await mkdtemp(join(tmpdir(), 'clawhub-e2e-sync-'))
    try {
      const skillDir = join(root, 'cool-skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), '# Skill\n', 'utf8')

      const result = spawnSync(
        'bun',
        [
          'clawhub',
          'sync',
          '--dry-run',
          '--all',
          '--root',
          root,
          '--site',
          site,
          '--registry',
          registry,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(result.status).toBe(0)
      expect(result.stderr).not.toMatch(/error:/i)
      expect(result.stdout).toMatch(/Dry run/i)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cfg.dir, { recursive: true, force: true })
    }
  })

  it('sync dry-run finds skills from clawdbot.json roots', async () => {
    const registry = getRegistry()
    const site = getSite()
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null
    if (!token) {
      throw new Error('Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login')
    }

    const cfg = await makeTempConfig(registry, token)
    const root = await mkdtemp(join(tmpdir(), 'clawhub-e2e-clawdbot-'))
    const stateDir = join(root, 'state')
    const configPath = join(root, 'clawdbot.json')
    const workspace = join(root, 'clawd-work')
    const skillsRoot = join(workspace, 'skills')
    const skillDir = join(skillsRoot, 'auto-skill')

    try {
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), '# Skill\n', 'utf8')

      const config = `{
        // JSON5-style comments + trailing commas
        routing: {
          agents: {
            work: { name: 'Work', workspace: '${workspace}', },
          },
        },
      }`
      await writeFile(configPath, config, 'utf8')

      const result = spawnSync(
        'bun',
        ['clawhub', 'sync', '--dry-run', '--all', '--site', site, '--registry', registry],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: '1',
            CLAWDBOT_CONFIG_PATH: configPath,
            CLAWDBOT_STATE_DIR: stateDir,
          },
          encoding: 'utf8',
        },
      )
      expect(result.status).toBe(0)
      expect(result.stderr).not.toMatch(/error:/i)
      expect(result.stdout).toMatch(/Dry run/i)
      expect(result.stdout).toMatch(/auto-skill/i)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cfg.dir, { recursive: true, force: true })
    }
  })

  it('publishes, deletes, and undeletes a skill (logged-in)', async () => {
    const registry = getRegistry()
    const site = getSite()
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null
    if (!token) {
      throw new Error('Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login')
    }

    const cfg = await makeTempConfig(registry, token)
    const workdir = await mkdtemp(join(tmpdir(), 'clawhub-e2e-publish-'))
    const installWorkdir = await mkdtemp(join(tmpdir(), 'clawhub-e2e-install-'))
    const slug = `e2e-${Date.now()}`
    const skillDir = join(workdir, slug)

    try {
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), `# ${slug}\n\nHello.\n`, 'utf8')

      const publish1 = spawnSync(
        'bun',
        [
          'clawhub',
          'publish',
          skillDir,
          '--slug',
          slug,
          '--name',
          `E2E ${slug}`,
          '--version',
          '1.0.0',
          '--tags',
          'latest',
          '--site',
          site,
          '--registry',
          registry,
          '--workdir',
          workdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(publish1.status).toBe(0)
      expect(publish1.stderr).not.toMatch(/changelog required/i)

      const publish2 = spawnSync(
        'bun',
        [
          'clawhub',
          'publish',
          skillDir,
          '--slug',
          slug,
          '--name',
          `E2E ${slug}`,
          '--version',
          '1.0.1',
          '--tags',
          'latest',
          '--site',
          site,
          '--registry',
          registry,
          '--workdir',
          workdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(publish2.status).toBe(0)
      expect(publish2.stderr).not.toMatch(/changelog required/i)

      const downloadUrl = new URL(ApiRoutes.download, registry)
      downloadUrl.searchParams.set('slug', slug)
      downloadUrl.searchParams.set('version', '1.0.1')
      const zipRes = await fetchWithTimeout(downloadUrl.toString())
      expect(zipRes.ok).toBe(true)
      const zipBytes = new Uint8Array(await zipRes.arrayBuffer())
      const unzipped = unzipSync(zipBytes)
      expect(Object.keys(unzipped)).toContain('SKILL.md')

      const install = spawnSync(
        'bun',
        [
          'clawhub',
          'install',
          slug,
          '--version',
          '1.0.0',
          '--force',
          '--site',
          site,
          '--registry',
          registry,
          '--workdir',
          installWorkdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(install.status).toBe(0)

      const list = spawnSync(
        'bun',
        ['clawhub', 'list', '--site', site, '--registry', registry, '--workdir', installWorkdir],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(list.status).toBe(0)
      expect(list.stdout).toMatch(new RegExp(`${slug}\\s+1\\.0\\.0`))

      const update = spawnSync(
        'bun',
        [
          'clawhub',
          'update',
          slug,
          '--force',
          '--site',
          site,
          '--registry',
          registry,
          '--workdir',
          installWorkdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(update.status).toBe(0)

      const metaUrl = new URL(`${ApiRoutes.skills}/${slug}`, registry)
      const metaRes = await fetchWithTimeout(metaUrl.toString(), {
        headers: { Accept: 'application/json' },
      })
      expect(metaRes.status).toBe(200)

      const del = spawnSync(
        'bun',
        [
          'clawhub',
          'delete',
          slug,
          '--yes',
          '--site',
          site,
          '--registry',
          registry,
          '--workdir',
          workdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(del.status).toBe(0)

      const metaAfterDelete = await fetchWithTimeout(metaUrl.toString(), {
        headers: { Accept: 'application/json' },
      })
      expect(metaAfterDelete.status).toBe(404)

      const downloadAfterDelete = await fetchWithTimeout(downloadUrl.toString())
      expect(downloadAfterDelete.status).toBe(404)

      const undelete = spawnSync(
        'bun',
        [
          'clawhub',
          'undelete',
          slug,
          '--yes',
          '--site',
          site,
          '--registry',
          registry,
          '--workdir',
          workdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      expect(undelete.status).toBe(0)

      const metaAfterUndelete = await fetchWithTimeout(metaUrl.toString(), {
        headers: { Accept: 'application/json' },
      })
      expect(metaAfterUndelete.status).toBe(200)
    } finally {
      const cleanup = spawnSync(
        'bun',
        [
          'clawhub',
          'delete',
          slug,
          '--yes',
          '--site',
          site,
          '--registry',
          registry,
          '--workdir',
          workdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: '1' },
          encoding: 'utf8',
        },
      )
      if (cleanup.status !== 0) {
        // best-effort cleanup
      }
      await rm(workdir, { recursive: true, force: true })
      await rm(installWorkdir, { recursive: true, force: true })
      await rm(cfg.dir, { recursive: true, force: true })
    }
  }, 180_000)
})
