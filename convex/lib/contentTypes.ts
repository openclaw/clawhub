const EXT_TO_TYPE: Record<string, string> = {
  md: 'text/markdown',
  mdx: 'text/markdown',
  json: 'application/json',
  json5: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  svg: 'image/svg+xml',
}

export function guessContentTypeForPath(path: string) {
  const trimmed = path.trim().toLowerCase()
  if (!trimmed) return 'application/octet-stream'
  const ext = trimmed.split('.').at(-1) ?? ''
  return EXT_TO_TYPE[ext] ?? 'application/octet-stream'
}

