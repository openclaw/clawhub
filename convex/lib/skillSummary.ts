import { getFrontmatterValue, parseFrontmatter } from './skills'

const SKILL_SUMMARY_MODEL = process.env.OPENAI_SKILL_SUMMARY_MODEL ?? 'gpt-4.1-mini'
const MAX_README_CHARS = 8_000
const MAX_SUMMARY_CHARS = 160

function clampText(value: string, maxChars: number) {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars).trimEnd()}\n...`
}

function normalizeSummary(value: string | null | undefined) {
  if (!value) return undefined
  const compact = value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
  if (!compact) return undefined
  if (compact.length <= MAX_SUMMARY_CHARS) return compact
  return `${compact.slice(0, MAX_SUMMARY_CHARS - 3).trimEnd()}...`
}

function deriveSummaryFallback(readmeText: string) {
  const frontmatter = parseFrontmatter(readmeText)
  const fromFrontmatter = normalizeSummary(getFrontmatterValue(frontmatter, 'description'))
  if (fromFrontmatter) return fromFrontmatter

  const lines = readmeText.split(/\r?\n/)
  let inFrontmatter = false
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (!inFrontmatter && trimmed === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (trimmed === '---') inFrontmatter = false
      continue
    }
    const cleaned = normalizeSummary(
      trimmed
        .replace(/^#+\s*/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+\.\s+/, ''),
    )
    if (cleaned) return cleaned
  }
  return undefined
}

function deriveIdentityFallback(args: { slug: string; displayName: string }) {
  const base = args.displayName.trim() || args.slug.trim()
  return normalizeSummary(`Automation skill for ${base}.`)
}

function extractResponseText(payload: unknown) {
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

export async function generateSkillSummary(args: {
  slug: string
  displayName: string
  readmeText: string
  currentSummary?: string
}) {
  const existing = normalizeSummary(args.currentSummary)
  if (existing) return existing

  const contentFallback = deriveSummaryFallback(args.readmeText)
  const fallback = contentFallback ?? deriveIdentityFallback(args)
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fallback
  if (!contentFallback) return fallback

  const input = [
    `Skill slug: ${args.slug}`,
    `Display name: ${args.displayName}`,
    `SKILL.md:\n${clampText(args.readmeText, MAX_README_CHARS)}`,
  ].join('\n\n')

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: SKILL_SUMMARY_MODEL,
        instructions:
          'Write a concise public skill description. Return plain text only, one sentence, max 160 characters. No markdown. No quotes. No hype. Be specific and accurate to SKILL.md.',
        input,
        max_output_tokens: 90,
      }),
    })
    if (!response.ok) return fallback
    const payload = (await response.json()) as unknown
    return normalizeSummary(extractResponseText(payload)) ?? fallback
  } catch {
    return fallback
  }
}

export const __test = {
  clampText,
  deriveSummaryFallback,
  normalizeSummary,
}
