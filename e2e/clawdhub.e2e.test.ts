/* @vitest-environment node */

import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ApiCliWhoamiResponseSchema,
  ApiRoutes,
  ApiSearchResponseSchema,
  parseArk,
} from 'clawdhub-schema'
import { describe, expect, it } from 'vitest'
import { readGlobalConfig } from '../packages/clawdhub/src/config'

function mustGetToken() {
  const fromEnv = process.env.CLAWDHUB_E2E_TOKEN?.trim()
  if (fromEnv) return fromEnv
  return null
}

async function makeTempConfig(registry: string, token: string | null) {
  const dir = await mkdtemp(join(tmpdir(), 'clawdhub-e2e-'))
  const path = join(dir, 'config.json')
  await writeFile(
    path,
    `${JSON.stringify({ registry, token: token || undefined }, null, 2)}\n`,
    'utf8',
  )
  return { dir, path }
}

describe('clawdhub e2e', () => {
  it('search endpoint returns a results array (schema parse)', async () => {
    const registry = process.env.CLAWDHUB_REGISTRY?.trim() || 'https://clawdhub.com'
    const url = new URL(ApiRoutes.search, registry)
    url.searchParams.set('q', 'gif')
    url.searchParams.set('limit', '5')

    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
    expect(response.ok).toBe(true)
    const json = (await response.json()) as unknown
    const parsed = parseArk(ApiSearchResponseSchema, json, 'API response')
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  it('cli search does not error on multi-result responses', async () => {
    const registry = process.env.CLAWDHUB_REGISTRY?.trim() || 'https://clawdhub.com'
    const site = process.env.CLAWDHUB_SITE?.trim() || 'https://clawdhub.com'
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null

    const cfg = await makeTempConfig(registry, token)
    try {
      const workdir = await mkdtemp(join(tmpdir(), 'clawdhub-e2e-workdir-'))
      const result = spawnSync(
        'bun',
        [
          'clawdhub',
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
          env: { ...process.env, CLAWDHUB_CONFIG_PATH: cfg.path },
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
    const registry = process.env.CLAWDHUB_REGISTRY?.trim() || 'https://clawdhub.com'
    const site = process.env.CLAWDHUB_SITE?.trim() || 'https://clawdhub.com'
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null
    if (!token) {
      throw new Error('Missing token. Set CLAWDHUB_E2E_TOKEN or run: bun clawdhub auth login')
    }

    const cfg = await makeTempConfig(registry, token)
    try {
      const whoamiUrl = new URL(ApiRoutes.cliWhoami, registry)
      const whoamiRes = await fetch(whoamiUrl.toString(), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      })
      expect(whoamiRes.ok).toBe(true)
      const whoami = parseArk(
        ApiCliWhoamiResponseSchema,
        (await whoamiRes.json()) as unknown,
        'Whoami',
      )
      expect(whoami.user).toBeTruthy()

      const result = spawnSync(
        'bun',
        ['clawdhub', 'whoami', '--site', site, '--registry', registry],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWDHUB_CONFIG_PATH: cfg.path },
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
    const registry = process.env.CLAWDHUB_REGISTRY?.trim() || 'https://clawdhub.com'
    const site = process.env.CLAWDHUB_SITE?.trim() || 'https://clawdhub.com'
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null
    if (!token) {
      throw new Error('Missing token. Set CLAWDHUB_E2E_TOKEN or run: bun clawdhub auth login')
    }

    const cfg = await makeTempConfig(registry, token)
    const root = await mkdtemp(join(tmpdir(), 'clawdhub-e2e-sync-'))
    try {
      const skillDir = join(root, 'cool-skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), '# Skill\n', 'utf8')

      const result = spawnSync(
        'bun',
        [
          'clawdhub',
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
          env: { ...process.env, CLAWDHUB_CONFIG_PATH: cfg.path },
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
})
