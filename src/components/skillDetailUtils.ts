import type { SkillInstallSpec, NixPluginSpec } from 'clawhub-schema'

const OS_LABELS: Record<string, string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}

export function formatOsList(os?: string[]): string[] {
  if (!os?.length) return []
  return os.map((o) => OS_LABELS[o.toLowerCase()] ?? o)
}

export function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---')) return content
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return content
  return normalized.slice(endIndex + 4).trimStart()
}

export function buildSkillHref(slug: string, ownerHandle?: string | null): string {
  const owner = ownerHandle?.trim() || '_'
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`
}

export function formatInstallLabel(spec: SkillInstallSpec): string {
  if (spec.label) return spec.label
  if (spec.kind === 'brew') return spec.formula ?? 'Homebrew'
  if (spec.kind === 'node') return spec.package ?? 'npm'
  if (spec.kind === 'go') return spec.module ?? 'Go'
  if (spec.kind === 'uv') return spec.package ?? 'uv'
  return spec.kind
}

export function formatInstallCommand(spec: SkillInstallSpec): string | null {
  if (spec.kind === 'brew') {
    const tap = spec.tap ? `brew tap ${spec.tap} && ` : ''
    return `${tap}brew install ${spec.formula ?? ''}`
  }
  if (spec.kind === 'node') return `npm install -g ${spec.package ?? ''}`
  if (spec.kind === 'go') return `go install ${spec.module ?? ''}`
  if (spec.kind === 'uv') return `uv tool install ${spec.package ?? ''}`
  return null
}

export function formatConfigSnippet(config: { requiredEnv?: string[]; stateDirs?: string[]; example?: string }): string {
  const lines: string[] = []
  if (config.requiredEnv?.length) lines.push(`Required env: ${config.requiredEnv.join(', ')}`)
  if (config.stateDirs?.length) lines.push(`State dirs: ${config.stateDirs.join(', ')}`)
  if (config.example) lines.push(`Example:\n${config.example}`)
  return lines.join('\n')
}

export function formatNixInstallSnippet(nix: NixPluginSpec): string {
  return `nix profile install ${nix.plugin}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
