import {
  type ClawdbotConfigSpec,
  type ClawdisSkillMetadata,
  ClawdisSkillMetadataSchema,
  isTextContentType,
  type NixPluginSpec,
  parseArk,
  type SkillInstallSpec,
  TEXT_FILE_EXTENSION_SET,
} from 'clawhub-schema'
import { parse as parseYaml } from 'yaml'

export type ParsedSkillFrontmatter = Record<string, unknown>
export type { ClawdisSkillMetadata, SkillInstallSpec }

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
      // Strip trailing commas in JSON objects/arrays (common authoring mistake)
      const cleaned = raw.replace(/,\s*([\]}])/g, '$1')
      const parsed = JSON.parse(cleaned) as unknown
      return parsed ?? undefined
    } catch {
      return undefined
    }
  }
  if (typeof raw === 'object') return raw
  return undefined
}

export function parseClawdisMetadata(frontmatter: ParsedSkillFrontmatter) {
  const metadata = getFrontmatterMetadata(frontmatter)
  const metadataRecord =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : undefined
  const clawdbotMeta = metadataRecord?.clawdbot
  const clawdisMeta = metadataRecord?.clawdis
  const openclawMeta = metadataRecord?.openclaw
  const metadataSource =
    clawdbotMeta && typeof clawdbotMeta === 'object' && !Array.isArray(clawdbotMeta)
      ? (clawdbotMeta as Record<string, unknown>)
      : clawdisMeta && typeof clawdisMeta === 'object' && !Array.isArray(clawdisMeta)
        ? (clawdisMeta as Record<string, unknown>)
        : openclawMeta && typeof openclawMeta === 'object' && !Array.isArray(openclawMeta)
          ? (openclawMeta as Record<string, unknown>)
          : undefined
  const clawdisRaw = metadataSource ?? frontmatter.clawdis

  // Support top-level frontmatter env/dependencies/author/links as fallback
  // even when no clawdis block exists (per #350)
  if (!clawdisRaw || typeof clawdisRaw !== 'object' || Array.isArray(clawdisRaw)) {
    return parseFrontmatterLevelDeclarations(frontmatter)
  }

  try {
    const clawdisObj = clawdisRaw as Record<string, unknown>
    const requiresRaw =
      typeof clawdisObj.requires === 'object' && clawdisObj.requires !== null
        ? (clawdisObj.requires as Record<string, unknown>)
        : undefined
    const installRaw = Array.isArray(clawdisObj.install) ? (clawdisObj.install as unknown[]) : []
    const install = installRaw
      .map((entry) => parseInstallSpec(entry))
      .filter((entry): entry is SkillInstallSpec => Boolean(entry))
    const osRaw = normalizeStringList(clawdisObj.os)

    const metadata: ClawdisSkillMetadata = {}
    if (typeof clawdisObj.always === 'boolean') metadata.always = clawdisObj.always
    if (typeof clawdisObj.emoji === 'string') metadata.emoji = clawdisObj.emoji
    if (typeof clawdisObj.homepage === 'string') metadata.homepage = clawdisObj.homepage
    if (typeof clawdisObj.skillKey === 'string') metadata.skillKey = clawdisObj.skillKey
    if (typeof clawdisObj.primaryEnv === 'string') metadata.primaryEnv = clawdisObj.primaryEnv
    if (typeof clawdisObj.cliHelp === 'string') metadata.cliHelp = clawdisObj.cliHelp
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
    const nix = parseNixPluginSpec(clawdisObj.nix)
    if (nix) metadata.nix = nix
    const config = parseClawdbotConfigSpec(clawdisObj.config)
    if (config) metadata.config = config

    // Parse env var declarations (detailed env with descriptions)
    const envVars = parseEnvVarDeclarations(clawdisObj.envVars ?? clawdisObj.env)
    if (envVars.length > 0) metadata.envVars = envVars

    // Parse dependency declarations
    const dependencies = parseDependencyDeclarations(clawdisObj.dependencies)
    if (dependencies.length > 0) metadata.dependencies = dependencies

    // Parse author and links
    if (typeof clawdisObj.author === 'string') metadata.author = clawdisObj.author
    const links = parseSkillLinks(clawdisObj.links)
    if (links) metadata.links = links

    return parseArk(ClawdisSkillMetadataSchema, metadata, 'Clawdis metadata')
  } catch {
    return undefined
  }
}

export function isTextFile(path: string, contentType?: string | null) {
  const trimmed = path.trim().toLowerCase()
  if (!trimmed) return false
  const parts = trimmed.split('.')
  const extension = parts.length > 1 ? (parts.at(-1) ?? '') : ''
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

function parseClawdbotConfigSpec(input: unknown): ClawdbotConfigSpec | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  const requiredEnv = normalizeStringList(raw.requiredEnv)
  const stateDirs = normalizeStringList(raw.stateDirs)
  const example = typeof raw.example === 'string' ? raw.example.trim() : ''
  const spec: ClawdbotConfigSpec = {}
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

/**
 * Parse env var declarations from frontmatter.
 * Accepts either an array of {name, required?, description?} objects
 * or a simple string array (converted to {name, required: true}).
 */
function parseEnvVarDeclarations(input: unknown): Array<{ name: string; required?: boolean; description?: string }> {
  if (!input) return []
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      if (typeof item === 'string') {
        return { name: item.trim(), required: true }
      }
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string') {
        const obj = item as Record<string, unknown>
        const decl: { name: string; required?: boolean; description?: string } = {
          name: String(obj.name).trim(),
        }
        if (typeof obj.required === 'boolean') decl.required = obj.required
        if (typeof obj.description === 'string') decl.description = obj.description.trim()
        return decl
      }
      return null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && item.name.length > 0)
}

/**
 * Parse dependency declarations from frontmatter.
 * Accepts an array of {name, type, version?, url?, repository?} objects.
 */
function parseDependencyDeclarations(input: unknown): Array<{
  name: string
  type: 'pip' | 'npm' | 'brew' | 'go' | 'cargo' | 'apt' | 'other'
  version?: string
  url?: string
  repository?: string
}> {
  if (!input || !Array.isArray(input)) return []
  const validTypes = new Set(['pip', 'npm', 'brew', 'go', 'cargo', 'apt', 'other'])
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const obj = item as Record<string, unknown>
      if (typeof obj.name !== 'string') return null
      const typeStr = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : 'other'
      const depType = validTypes.has(typeStr)
        ? (typeStr as 'pip' | 'npm' | 'brew' | 'go' | 'cargo' | 'apt' | 'other')
        : 'other'
      const decl: {
        name: string
        type: typeof depType
        version?: string
        url?: string
        repository?: string
      } = { name: String(obj.name).trim(), type: depType }
      if (typeof obj.version === 'string') decl.version = obj.version.trim()
      if (typeof obj.url === 'string') decl.url = obj.url.trim()
      if (typeof obj.repository === 'string') decl.repository = obj.repository.trim()
      return decl
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && item.name.length > 0)
}

/**
 * Parse links object from frontmatter.
 */
function parseSkillLinks(input: unknown): { homepage?: string; repository?: string; documentation?: string; changelog?: string } | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const obj = input as Record<string, unknown>
  const links: { homepage?: string; repository?: string; documentation?: string; changelog?: string } = {}
  if (typeof obj.homepage === 'string') links.homepage = obj.homepage.trim()
  if (typeof obj.repository === 'string') links.repository = obj.repository.trim()
  if (typeof obj.documentation === 'string') links.documentation = obj.documentation.trim()
  if (typeof obj.changelog === 'string') links.changelog = obj.changelog.trim()
  return Object.keys(links).length > 0 ? links : undefined
}

/**
 * Parse top-level frontmatter env/dependencies/author/links
 * when no clawdis block is present (fallback for #350).
 */
function parseFrontmatterLevelDeclarations(frontmatter: ParsedSkillFrontmatter): ClawdisSkillMetadata | undefined {
  const metadata: ClawdisSkillMetadata = {}

  const envVars = parseEnvVarDeclarations(frontmatter.env)
  if (envVars.length > 0) metadata.envVars = envVars

  const dependencies = parseDependencyDeclarations(frontmatter.dependencies)
  if (dependencies.length > 0) metadata.dependencies = dependencies

  if (typeof frontmatter.author === 'string') metadata.author = String(frontmatter.author).trim()

  const links = parseSkillLinks(frontmatter.links)
  if (links) metadata.links = links

  if (typeof frontmatter.homepage === 'string') {
    metadata.homepage = String(frontmatter.homepage).trim()
  }

  return Object.keys(metadata).length > 0
    ? parseArk(ClawdisSkillMetadataSchema, metadata, 'Clawdis metadata')
    : undefined
}
