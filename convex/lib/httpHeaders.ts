function toHeaderRecord(init?: HeadersInit): Record<string, string> {
  if (!init) return {}
  if (init instanceof Headers) return Object.fromEntries(init.entries())
  if (Array.isArray(init)) return Object.fromEntries(init)
  return { ...(init as Record<string, string>) }
}

export function mergeHeaders(...inits: Array<HeadersInit | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const init of inits) {
    Object.assign(out, toHeaderRecord(init))
  }
  return out
}

export function corsHeaders(origin: string = '*'): Record<string, string> {
  return { 'Access-Control-Allow-Origin': origin }
}

