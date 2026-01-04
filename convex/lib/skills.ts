import {
  type ClawdisSkillMetadata,
  ClawdisSkillMetadataSchema,
  isTextContentType,
  parseArk,
  type SkillInstallSpec,
  TEXT_FILE_EXTENSION_SET,
} from 'clawdhub-schema'

export type ParsedSkillFrontmatter = Record<string, string>
export type { ClawdisSkillMetadata, SkillInstallSpec }

const FRONTMATTER_START = '---'

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  const frontmatter: ParsedSkillFrontmatter = {}
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.startsWith(FRONTMATTER_START)) return frontmatter
  const endIndex = normalized.indexOf(`\n${FRONTMATTER_START}`, 3)
  if (endIndex === -1) return frontmatter
  const block = normalized.slice(4, endIndex)
  for (const line of block.split('\n')) {
    const match = line.match(/^([\w-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const rawValue = match[2].trim()
    if (!key || !rawValue) continue
    frontmatter[key] = stripQuotes(rawValue)
  }
  return frontmatter
}

export function getFrontmatterValue(frontmatter: ParsedSkillFrontmatter, key: string) {
  const raw = frontmatter[key]
  return typeof raw === 'string' ? raw : undefined
}

export function parseClawdisMetadata(frontmatter: ParsedSkillFrontmatter) {
  const raw = getFrontmatterValue(frontmatter, 'metadata')
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as { clawdis?: unknown }
    if (!parsed || typeof parsed !== 'object') return undefined
    const clawdis = (parsed as { clawdis?: unknown }).clawdis
    if (!clawdis || typeof clawdis !== 'object') return undefined
    const clawdisObj = clawdis as Record<string, unknown>
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
  const { frontmatter, readme, otherFiles, maxChars = 200_000 } = params
  const headerParts = [
    frontmatter.name,
    frontmatter.description,
    frontmatter.homepage,
    frontmatter.website,
    frontmatter.url,
    frontmatter.emoji,
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

function stripQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
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

function toHex(bytes: Uint8Array) {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}
