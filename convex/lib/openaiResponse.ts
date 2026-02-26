export function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const output = (payload as { output?: unknown }).output
  if (!Array.isArray(output)) return null
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    if ((item as { type?: unknown }).type !== 'message') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      if ((part as { type?: unknown }).type !== 'output_text') continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string' && text.trim()) chunks.push(text)
    }
  }
  const joined = chunks.join('\n').trim()
  return joined || null
}
