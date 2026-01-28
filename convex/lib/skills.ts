import {
  isTextContentType,
  type MoltbotConfigSpec,
  type MoltbotSkillMetadata,
  MoltbotSkillMetadataSchema,
  type NixPluginSpec,
  parseArk,
  type SkillInstallSpec,
  TEXT_FILE_EXTENSION_SET,
} from 'molthub-schema'
import { parse as parseYaml } from 'yaml'

export type ParsedSkillFrontmatter = Record<string, unknown>
export type { MoltbotSkillMetadata, SkillInstallSpec }

const FRONTMATTER_START = '---'
const DEFAULT_EMBEDDING_MAX_CHARS = 12_000

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  const frontmatter: ParsedSkillFrontmatter = {}
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.startsWith(FRONTMATTER_START)) return frontmatter
  const endIndex = normalized.indexOf(`\n${FRONTMATTER_START}`, 3)
  if (endIndex === -1) return frontmatter
  const block = normalized.slice(4, endIndex)

  try {
    const parsed = parseYaml(block) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return frontmatter
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^[\w-]+$/.test(key)) continue
      const jsonValue = toJsonValue(value)
      if (jsonValue !== undefined) frontmatter[key] = jsonValue
    }
  } catch {
    return frontmatter
  }

  return frontmatter
}

export function getFrontmatterValue(frontmatter: ParsedSkillFrontmatter, key: string) {
  const raw = frontmatter[key]
  return typeof raw === 'string' ? raw : undefined
}

export function getFrontmatterMetadata(frontmatter: ParsedSkillFrontmatter) {
  const raw = frontmatter.metadata
  if (!raw) return undefined
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return parsed ?? undefined
    } catch {
      return undefined
    }
  }
  if (typeof raw === 'object') return raw
  return undefined
}

export function parseMoltbotMetadata(frontmatter: ParsedSkillFrontmatter) {
  const metadata = getFrontmatterMetadata(frontmatter)
  const metadataRecord =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : undefined
  const moltbotMeta = metadataRecord?.moltbot
  const metadataSource =
    moltbotMeta && typeof moltbotMeta === 'object' && !Array.isArray(moltbotMeta)
      ? (moltbotMeta as Record<string, unknown>)
      : undefined
  const moltbotRaw = metadataSource ?? frontmatter.moltbot
  if (!moltbotRaw || typeof moltbotRaw !== 'object' || Array.isArray(moltbotRaw)) return undefined

  try {
    const moltbotObj = moltbotRaw as Record<string, unknown>
    const requiresRaw =
      typeof moltbotObj.requires === 'object' && moltbotObj.requires !== null
        ? (moltbotObj.requires as Record<string, unknown>)
        : undefined
    const installRaw = Array.isArray(moltbotObj.install) ? (moltbotObj.install as unknown[]) : []
    const install = installRaw
      .map((entry) => parseInstallSpec(entry))
      .filter((entry): entry is SkillInstallSpec => Boolean(entry))
    const osRaw = normalizeStringList(moltbotObj.os)

    const metadata: MoltbotSkillMetadata = {}
    if (typeof moltbotObj.always === 'boolean') metadata.always = moltbotObj.always
    if (typeof moltbotObj.emoji === 'string') metadata.emoji = moltbotObj.emoji
    if (typeof moltbotObj.homepage === 'string') metadata.homepage = moltbotObj.homepage
    if (typeof moltbotObj.skillKey === 'string') metadata.skillKey = moltbotObj.skillKey
    if (typeof moltbotObj.primaryEnv === 'string') metadata.primaryEnv = moltbotObj.primaryEnv
    if (typeof moltbotObj.cliHelp === 'string') metadata.cliHelp = moltbotObj.cliHelp
    if (osRaw.length > 0) metadata.os = osRaw

    if (requiresRaw) {
      const bins = normalizeStringList(requiresRaw.bins)
      const anyBins = normalizeStringList(requiresRaw.anyBins)
      const env = normalizeStringList(requiresRaw.env)
      const config = normalizeStringList(requiresRaw.config)
      if (bins.length || anyBins.length || env.length || config.length) {
        metadata.requires = {}
        if (bins.length) metadata.requires.bins = bins
        if (anyBins.length) metadata.requires.anyBins = anyBins
        if (env.length) metadata.requires.env = env
        if (config.length) metadata.requires.config = config
      }
    }

    if (install.length > 0) metadata.install = install
    const nix = parseNixPluginSpec(moltbotObj.nix)
    if (nix) metadata.nix = nix
    const config = parseMoltbotConfigSpec(moltbotObj.config)
    if (config) metadata.config = config

    return parseArk(MoltbotSkillMetadataSchema, metadata, 'Moltbot metadata')
  } catch {
    return undefined
  }
}

export function isTextFile(path: string, contentType?: string | null) {
  const trimmed = path.trim().toLowerCase()
  if (!trimmed) return false
  const parts = trimmed.split('.')
  const extension = parts.length > 1 ? (parts.at(-1) ?? '') : ''
  const normalizedContentType = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (normalizedContentType === 'image/svg+xml' || extension === 'svg') return false
  if (contentType) {
    if (isTextContentType(contentType)) return true
  }
  if (extension && TEXT_FILE_EXTENSION_SET.has(extension)) return true
  return false
}

export function sanitizePath(path: string) {
  const trimmed = path.trim().replace(/^\/+/, '')
  if (!trimmed || trimmed.includes('..') || trimmed.includes('\\')) {
    return null
  }
  return trimmed
}

export function buildEmbeddingText(params: {
  frontmatter: ParsedSkillFrontmatter
  readme: string
  otherFiles: Array<{ path: string; content: string }>
  maxChars?: number
}) {
  const { frontmatter, readme, otherFiles, maxChars = DEFAULT_EMBEDDING_MAX_CHARS } = params
  const headerParts = [
    getFrontmatterValue(frontmatter, 'name'),
    getFrontmatterValue(frontmatter, 'description'),
    getFrontmatterValue(frontmatter, 'homepage'),
    getFrontmatterValue(frontmatter, 'website'),
    getFrontmatterValue(frontmatter, 'url'),
    getFrontmatterValue(frontmatter, 'emoji'),
  ].filter(Boolean)
  const fileParts = otherFiles.map((file) => `# ${file.path}\n${file.content}`)
  const raw = [headerParts.join('\n'), readme, ...fileParts].filter(Boolean).join('\n\n')
  if (raw.length <= maxChars) return raw
  return raw.slice(0, maxChars)
}

const encoder = new TextEncoder()

export async function hashSkillFiles(files: Array<{ path: string; sha256: string }>) {
  const normalized = files
    .filter((file) => Boolean(file.path) && Boolean(file.sha256))
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const payload = normalized.map((file) => `${file.path}:${file.sha256}`).join('\n')
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload))
  return toHex(new Uint8Array(digest))
}

function toJsonValue(value: unknown): unknown {
  if (value === null) return null
  if (value === undefined) return undefined
  if (typeof value === 'string') {
    const trimmedEnd = value.trimEnd()
    return trimmedEnd.trim() ? trimmedEnd : undefined
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const next = toJsonValue(entry)
      return next === undefined ? null : next
    })
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const next = toJsonValue(entry)
      if (next !== undefined) out[key] = next
    }
    return out
  }
  return undefined
}

function normalizeStringList(input: unknown): string[] {
  if (!input) return []
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean)
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
  return []
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  const kindRaw =
    typeof raw.kind === 'string' ? raw.kind : typeof raw.type === 'string' ? raw.type : ''
  const kind = kindRaw.trim().toLowerCase()
  if (kind !== 'brew' && kind !== 'node' && kind !== 'go' && kind !== 'uv') return undefined

  const spec: SkillInstallSpec = { kind: kind as SkillInstallSpec['kind'] }
  if (typeof raw.id === 'string') spec.id = raw.id
  if (typeof raw.label === 'string') spec.label = raw.label
  const bins = normalizeStringList(raw.bins)
  if (bins.length > 0) spec.bins = bins
  if (typeof raw.formula === 'string') spec.formula = raw.formula
  if (typeof raw.tap === 'string') spec.tap = raw.tap
  if (typeof raw.package === 'string') spec.package = raw.package
  if (typeof raw.module === 'string') spec.module = raw.module
  return spec
}

function parseNixPluginSpec(input: unknown): NixPluginSpec | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  if (typeof raw.plugin !== 'string') return undefined
  const plugin = raw.plugin.trim()
  if (!plugin) return undefined
  const systems = normalizeStringList(raw.systems)
  const spec: NixPluginSpec = { plugin }
  if (systems.length > 0) spec.systems = systems
  return spec
}

function parseMoltbotConfigSpec(input: unknown): MoltbotConfigSpec | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  const requiredEnv = normalizeStringList(raw.requiredEnv)
  const stateDirs = normalizeStringList(raw.stateDirs)
  const example = typeof raw.example === 'string' ? raw.example.trim() : ''
  const spec: MoltbotConfigSpec = {}
  if (requiredEnv.length > 0) spec.requiredEnv = requiredEnv
  if (stateDirs.length > 0) spec.stateDirs = stateDirs
  if (example) spec.example = example
  return Object.keys(spec).length > 0 ? spec : undefined
}

function toHex(bytes: Uint8Array) {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
