const TRUST_TIER_ACCOUNT_AGE_LOW_MS = 30 * 24 * 60 * 60 * 1000
const TRUST_TIER_ACCOUNT_AGE_MEDIUM_MS = 90 * 24 * 60 * 60 * 1000
const TRUST_TIER_SKILLS_LOW = 10
const TRUST_TIER_SKILLS_MEDIUM = 50
const TEMPLATE_MARKERS = [
  'expert guidance for',
  'practical skill guidance',
  'step-by-step tutorials',
  'tips and techniques',
  'project ideas',
  'resource recommendations',
  'help with this skill',
  'learning guidance',
] as const

export type TrustTier = 'low' | 'medium' | 'trusted'

export type QualitySignals = {
  bodyChars: number
  bodyWords: number
  uniqueWordRatio: number
  headingCount: number
  bulletCount: number
  templateMarkerHits: number
  genericSummary: boolean
  cjkChars: number
  structuralFingerprint: string
}

export type QualityAssessment = {
  score: number
  decision: 'pass' | 'quarantine' | 'reject'
  reason: string
  trustTier: TrustTier
  similarRecentCount: number
  signals: Omit<QualitySignals, 'structuralFingerprint'>
}

function stripFrontmatter(raw: string) {
  return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/m, '')
}

function tokenizeWords(text: string) {
  const segmenterCtor = (Intl as typeof Intl & {
    Segmenter?: new (
      locale?: string | string[],
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
    ) => {
      segment: (
        input: string,
      ) => Iterable<{ segment: string; isWordLike?: boolean }>
    }
  }).Segmenter

  if (segmenterCtor) {
    const segmenter = new segmenterCtor(undefined, { granularity: 'word' })
    const tokens: string[] = []
    for (const entry of segmenter.segment(text)) {
      if (!entry.isWordLike) continue
      const token = entry.segment.trim().toLowerCase()
      if (!token) continue
      tokens.push(token)
    }
    if (tokens.length > 0) return tokens
  }

  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).filter((word) => word.length > 1)
}

function wordBucket(text: string) {
  const words = tokenizeWords(text).length
  if (words <= 2) return 's'
  if (words <= 6) return 'm'
  return 'l'
}

export function toStructuralFingerprint(markdown: string) {
  const body = stripFrontmatter(markdown)
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80)

  return lines
    .map((line) => {
      if (line.startsWith('### ')) return `h3:${wordBucket(line.slice(4))}`
      if (line.startsWith('## ')) return `h2:${wordBucket(line.slice(3))}`
      if (line.startsWith('# ')) return `h1:${wordBucket(line.slice(2))}`
      if (/^[-*]\s+/.test(line)) return `b:${wordBucket(line.replace(/^[-*]\s+/, ''))}`
      if (/^\d+\.\s+/.test(line)) return `n:${wordBucket(line.replace(/^\d+\.\s+/, ''))}`
      return `p:${wordBucket(line)}`
    })
    .join('|')
}

export function getTrustTier(accountAgeMs: number, totalSkills: number): TrustTier {
  if (accountAgeMs < TRUST_TIER_ACCOUNT_AGE_LOW_MS || totalSkills < TRUST_TIER_SKILLS_LOW) {
    return 'low'
  }
  if (accountAgeMs < TRUST_TIER_ACCOUNT_AGE_MEDIUM_MS || totalSkills < TRUST_TIER_SKILLS_MEDIUM) {
    return 'medium'
  }
  return 'trusted'
}

export function computeQualitySignals(args: {
  readmeText: string
  summary: string | null | undefined
}): QualitySignals {
  const body = stripFrontmatter(args.readmeText)
  const bodyChars = body.replace(/\s+/g, '').length
  const words = tokenizeWords(body)
  const uniqueWordRatio = words.length ? new Set(words).size / words.length : 0
  const lines = body.split('\n')
  const headingCount = lines.filter((line) => /^#{1,3}\s+/.test(line.trim())).length
  const bulletCount = lines.filter((line) => /^[-*]\s+/.test(line.trim())).length
  const bodyLower = body.toLowerCase()
  const templateMarkerHits = TEMPLATE_MARKERS.filter((marker) => bodyLower.includes(marker)).length
  const summary = (args.summary ?? '').trim().toLowerCase()
  const genericSummary = /^expert guidance for [a-z0-9-]+\.?$/.test(summary)
  const cjkChars = (body.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length

  return {
    bodyChars,
    bodyWords: words.length,
    uniqueWordRatio,
    headingCount,
    bulletCount,
    templateMarkerHits,
    genericSummary,
    cjkChars,
    structuralFingerprint: toStructuralFingerprint(args.readmeText),
  }
}

function scoreQuality(signals: QualitySignals) {
  let score = 100
  if (signals.bodyChars < 250) score -= 28
  if (signals.bodyWords < 80) score -= 24
  if (signals.uniqueWordRatio < 0.45) score -= 14
  if (signals.headingCount < 2) score -= 10
  if (signals.bulletCount < 3) score -= 8
  score -= Math.min(28, signals.templateMarkerHits * 9)
  if (signals.genericSummary) score -= 20
  return Math.max(0, score)
}

export function evaluateQuality(args: {
  signals: QualitySignals
  trustTier: TrustTier
  similarRecentCount: number
}): QualityAssessment {
  const { signals, trustTier, similarRecentCount } = args
  const score = scoreQuality(signals)
  const cjkHeavy =
    signals.cjkChars >= 40 || (signals.bodyChars > 0 && signals.cjkChars / signals.bodyChars >= 0.15)
  let rejectWordsThreshold = trustTier === 'low' ? 45 : trustTier === 'medium' ? 35 : 28
  let rejectCharsThreshold = trustTier === 'low' ? 260 : trustTier === 'medium' ? 180 : 140
  if (cjkHeavy) {
    rejectWordsThreshold = Math.max(24, rejectWordsThreshold - 16)
    rejectCharsThreshold = Math.max(140, rejectCharsThreshold - 120)
  }
  const quarantineScoreThreshold = trustTier === 'low' ? 72 : trustTier === 'medium' ? 60 : 50
  const similarityRejectThreshold = trustTier === 'low' ? 5 : trustTier === 'medium' ? 8 : 12

  const hardReject =
    signals.bodyWords < rejectWordsThreshold ||
    signals.bodyChars < rejectCharsThreshold ||
    (signals.templateMarkerHits >= 3 && signals.bodyWords < 120) ||
    similarRecentCount >= similarityRejectThreshold

  if (hardReject) {
    const reason =
      similarRecentCount >= similarityRejectThreshold
        ? 'Skill appears to be repeated template spam from this account.'
        : 'Skill content is too thin or templated. Add meaningful, specific documentation.'
    return {
      score,
      decision: 'reject',
      reason,
      trustTier,
      similarRecentCount,
      signals: {
        bodyChars: signals.bodyChars,
        bodyWords: signals.bodyWords,
        uniqueWordRatio: signals.uniqueWordRatio,
        headingCount: signals.headingCount,
        bulletCount: signals.bulletCount,
        templateMarkerHits: signals.templateMarkerHits,
        genericSummary: signals.genericSummary,
        cjkChars: signals.cjkChars,
      },
    }
  }

  if (score < quarantineScoreThreshold) {
    return {
      score,
      decision: 'quarantine',
      reason: 'Skill quality is low and requires moderation review before being listed.',
      trustTier,
      similarRecentCount,
      signals: {
        bodyChars: signals.bodyChars,
        bodyWords: signals.bodyWords,
        uniqueWordRatio: signals.uniqueWordRatio,
        headingCount: signals.headingCount,
        bulletCount: signals.bulletCount,
        templateMarkerHits: signals.templateMarkerHits,
        genericSummary: signals.genericSummary,
        cjkChars: signals.cjkChars,
      },
    }
  }

  return {
    score,
    decision: 'pass',
    reason: 'Quality checks passed.',
    trustTier,
    similarRecentCount,
    signals: {
      bodyChars: signals.bodyChars,
      bodyWords: signals.bodyWords,
      uniqueWordRatio: signals.uniqueWordRatio,
      headingCount: signals.headingCount,
      bulletCount: signals.bulletCount,
      templateMarkerHits: signals.templateMarkerHits,
      genericSummary: signals.genericSummary,
      cjkChars: signals.cjkChars,
    },
  }
}
