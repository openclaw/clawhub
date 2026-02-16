import type { SkillInstallSpec } from 'clawhub-schema'
import type { Id } from '../../convex/_generated/dataModel'

export function buildSkillHref(ownerHandle: string | null, ownerId: Id<'users'> | null, slug: string) {
  const owner = ownerHandle?.trim() || (ownerId ? String(ownerId) : 'unknown')
  return `/${owner}/${slug}`
}

export function formatConfigSnippet(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed || raw.includes('\n')) return raw
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    // fall through
  }

  let out = ''
  let indent = 0
  let inString = false
  let isEscaped = false

  const newline = () => {
    out = out.replace(/[ \t]+$/u, '')
    out += `\n${' '.repeat(indent * 2)}`
  }

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      out += ch
      if (isEscaped) {
        isEscaped = false
      } else if (ch === '\\') {
        isEscaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }

    if (ch === '{' || ch === '[') {
      out += ch
      indent += 1
      newline()
      continue
    }

    if (ch === '}' || ch === ']') {
      indent = Math.max(0, indent - 1)
      newline()
      out += ch
      continue
    }

    if (ch === ';' || ch === ',') {
      out += ch
      newline()
      continue
    }

    if (ch === '\n' || ch === '\r' || ch === '\t') {
      continue
    }

    if (ch === ' ') {
      if (out.endsWith(' ') || out.endsWith('\n')) {
        continue
      }
      out += ' '
      continue
    }

    out += ch
  }

  return out.trim()
}

export function stripFrontmatter(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.startsWith('---')) return content
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return content
  return normalized.slice(endIndex + 4).replace(/^\n+/, '')
}

export function formatOsList(os?: string[]) {
  if (!os?.length) return []
  return os.map((entry) => {
    const key = entry.trim().toLowerCase()
    if (key === 'darwin' || key === 'macos' || key === 'mac') return 'macOS'
    if (key === 'linux') return 'Linux'
    if (key === 'windows' || key === 'win32') return 'Windows'
    return entry
  })
}

export function formatInstallLabel(spec: SkillInstallSpec) {
  if (spec.kind === 'brew') return 'Homebrew'
  if (spec.kind === 'node') return 'Node'
  if (spec.kind === 'go') return 'Go'
  if (spec.kind === 'uv') return 'uv'
  return 'Install'
}

export function formatInstallCommand(spec: SkillInstallSpec) {
  if (spec.kind === 'brew' && spec.formula) {
    if (spec.tap && !spec.formula.includes('/')) {
      return `brew install ${spec.tap}/${spec.formula}`
    }
    return `brew install ${spec.formula}`
  }
  if (spec.kind === 'node' && spec.package) {
    return `npm i -g ${spec.package}`
  }
  if (spec.kind === 'go' && spec.module) {
    return `go install ${spec.module}`
  }
  if (spec.kind === 'uv' && spec.package) {
    return `uv tool install ${spec.package}`
  }
  return null
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

export function formatNixInstallSnippet(plugin: string) {
  const snippet = `programs.clawdbot.plugins = [ { source = "${plugin}"; } ];`
  return formatConfigSnippet(snippet)
}
