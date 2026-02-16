import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import JSON5 from 'json5'
import { resolveHome } from '../homedir.js'

type ClawdbotConfig = {
  agent?: { workspace?: string }
  agents?: {
    defaults?: { workspace?: string }
    list?: Array<{
      id?: string
      name?: string
      workspace?: string
      default?: boolean
    }>
  }
  routing?: {
    agents?: Record<
      string,
      {
        name?: string
        workspace?: string
      }
    >
  }
  skills?: {
    load?: {
      extraDirs?: string[]
    }
  }
}

export type ClawdbotSkillRoots = {
  roots: string[]
  labels: Record<string, string>
}

export async function resolveClawdbotSkillRoots(): Promise<ClawdbotSkillRoots> {
  const roots: string[] = []
  const labels: Record<string, string> = {}

  const clawdbotStateDir = resolveClawdbotStateDir()
  const sharedSkills = resolveUserPath(join(clawdbotStateDir, 'skills'))
  pushRoot(roots, labels, sharedSkills, 'Shared skills')

  const openclawStateDir = resolveOpenclawStateDir()
  const openclawShared = resolveUserPath(join(openclawStateDir, 'skills'))
  pushRoot(roots, labels, openclawShared, 'OpenClaw: Shared skills')

  const [clawdbotConfig, openclawConfig] = await Promise.all([
    readClawdbotConfig(),
    readOpenclawConfig(),
  ])
  if (!clawdbotConfig && !openclawConfig) return { roots, labels }

  if (clawdbotConfig) {
    addConfigRoots(clawdbotConfig, roots, labels)
  }
  if (openclawConfig) {
    addConfigRoots(openclawConfig, roots, labels, 'OpenClaw')
  }

  return { roots, labels }
}

export async function resolveClawdbotDefaultWorkspace(): Promise<string | null> {
  const config = await readClawdbotConfig()
  const openclawConfig = await readOpenclawConfig()
  if (!config && !openclawConfig) return null

  const defaultsWorkspace = resolveUserPath(
    config?.agents?.defaults?.workspace ?? config?.agent?.workspace ?? '',
  )
  if (defaultsWorkspace) return defaultsWorkspace

  const listedAgents = config?.agents?.list ?? []
  const defaultAgent =
    listedAgents.find((entry) => entry.default) ?? listedAgents.find((entry) => entry.id === 'main')
  const listWorkspace = resolveUserPath(defaultAgent?.workspace ?? '')
  if (listWorkspace) return listWorkspace

  if (!openclawConfig) return null
  const openclawDefaults = resolveUserPath(
    openclawConfig.agents?.defaults?.workspace ?? openclawConfig.agent?.workspace ?? '',
  )
  if (openclawDefaults) return openclawDefaults
  const openclawAgents = openclawConfig.agents?.list ?? []
  const openclawDefaultAgent =
    openclawAgents.find((entry) => entry.default) ??
    openclawAgents.find((entry) => entry.id === 'main')
  const openclawWorkspace = resolveUserPath(openclawDefaultAgent?.workspace ?? '')
  return openclawWorkspace || null
}

function resolveClawdbotStateDir() {
  const override = process.env.CLAWDBOT_STATE_DIR?.trim()
  if (override) return resolveUserPath(override)
  return join(resolveHome(), '.clawdbot')
}

function resolveClawdbotConfigPath() {
  const override = process.env.CLAWDBOT_CONFIG_PATH?.trim()
  if (override) return resolveUserPath(override)
  return join(resolveClawdbotStateDir(), 'clawdbot.json')
}

function resolveOpenclawStateDir() {
  const override = process.env.OPENCLAW_STATE_DIR?.trim()
  if (override) return resolveUserPath(override)
  return join(resolveHome(), '.openclaw')
}

function resolveOpenclawConfigPath() {
  const override = process.env.OPENCLAW_CONFIG_PATH?.trim()
  if (override) return resolveUserPath(override)
  return join(resolveOpenclawStateDir(), 'openclaw.json')
}

function resolveUserPath(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('~')) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, resolveHome()))
  }
  return resolve(trimmed)
}

async function readClawdbotConfig(): Promise<ClawdbotConfig | null> {
  return readConfigFile(resolveClawdbotConfigPath())
}

async function readOpenclawConfig(): Promise<ClawdbotConfig | null> {
  return readConfigFile(resolveOpenclawConfigPath())
}

async function readConfigFile(path: string): Promise<ClawdbotConfig | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON5.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as ClawdbotConfig
  } catch {
    return null
  }
}

function addConfigRoots(
  config: ClawdbotConfig,
  roots: string[],
  labels: Record<string, string>,
  labelPrefix?: string,
) {
  const prefix = labelPrefix ? `${labelPrefix}: ` : ''

  const mainWorkspace = resolveUserPath(
    config.agents?.defaults?.workspace ?? config.agent?.workspace ?? '',
  )
  if (mainWorkspace) {
    pushRoot(roots, labels, join(mainWorkspace, 'skills'), `${prefix}Agent: main`)
  }

  const listedAgents = config.agents?.list ?? []
  for (const entry of listedAgents) {
    const workspace = resolveUserPath(entry?.workspace ?? '')
    if (!workspace) continue
    const name = entry?.name?.trim() || entry?.id?.trim() || 'agent'
    pushRoot(roots, labels, join(workspace, 'skills'), `${prefix}Agent: ${name}`)
  }

  const agents = config.routing?.agents ?? {}
  for (const [agentId, entry] of Object.entries(agents)) {
    const workspace = resolveUserPath(entry?.workspace ?? '')
    if (!workspace) continue
    const name = entry?.name?.trim() || agentId
    pushRoot(roots, labels, join(workspace, 'skills'), `${prefix}Agent: ${name}`)
  }

  const extraDirs = config.skills?.load?.extraDirs ?? []
  for (const dir of extraDirs) {
    const resolved = resolveUserPath(String(dir))
    if (!resolved) continue
    const label = `${prefix}Extra: ${basename(resolved) || resolved}`
    pushRoot(roots, labels, resolved, label)
  }
}

function pushRoot(roots: string[], labels: Record<string, string>, root: string, label?: string) {
  const resolved = resolveUserPath(root)
  if (!resolved) return
  if (!roots.includes(resolved)) roots.push(resolved)
  if (!label) return
  const existing = labels[resolved]
  if (!existing) {
    labels[resolved] = label
    return
  }
  const parts = existing
    .split(', ')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.includes(label)) return
  labels[resolved] = `${existing}, ${label}`
}
