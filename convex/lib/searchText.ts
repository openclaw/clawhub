const WORD_RE = /[a-z0-9]+/g

function normalize(value: string) {
  return value.toLowerCase()
}

export function tokenize(value: string): string[] {
  if (!value) return []
  return normalize(value).match(WORD_RE) ?? []
}

/**
 * Returns a match score (0 = no match, higher = better) based on how well
 * the query tokens match the candidate text parts.
 *
 * Scoring:
 *  - Each query token that exactly matches a text token: +2
 *  - Each query token that prefix-matches a text token: +1
 *  - Bonus if ALL query tokens match: +3
 *
 * Returns 0 if fewer than half the query tokens match (for single-token queries, must match).
 */
export function scoreTokenMatch(
  queryTokens: string[],
  parts: Array<string | null | undefined>,
): number {
  if (queryTokens.length === 0) return 0
  const text = parts.filter((part) => Boolean(part?.trim())).join(' ')
  if (!text) return 0
  const textTokens = tokenize(text)
  if (textTokens.length === 0) return 0

  let score = 0
  let matched = 0

  for (const queryToken of queryTokens) {
    const hasExact = textTokens.some((t) => t === queryToken)
    if (hasExact) {
      score += 2
      matched++
    } else {
      const hasPrefix = textTokens.some((t) => t.startsWith(queryToken))
      if (hasPrefix) {
        score += 1
        matched++
      }
    }
  }

  // Require majority of query tokens to match (all for 1-2 token queries)
  const minRequired = queryTokens.length <= 2 ? queryTokens.length : Math.ceil(queryTokens.length * 0.6)
  if (matched < minRequired) return 0

  // Bonus for all tokens matching
  if (matched === queryTokens.length) score += 3

  return score
}

/**
 * Legacy boolean check — returns true if ALL query tokens prefix-match
 * at least one text token. This is stricter than the old behavior
 * (which only required ONE token) to prevent false positives.
 */
export function matchesExactTokens(
  queryTokens: string[],
  parts: Array<string | null | undefined>,
): boolean {
  if (queryTokens.length === 0) return false
  const text = parts.filter((part) => Boolean(part?.trim())).join(' ')
  if (!text) return false
  const textTokens = tokenize(text)
  if (textTokens.length === 0) return false
  // Require ALL query tokens to prefix-match at least one text token.
  // This prevents "Remind Me" from matching skills that only contain "me".
  return queryTokens.every((queryToken) =>
    textTokens.some((textToken) => textToken.startsWith(queryToken)),
  )
}

export const __test = { normalize, tokenize, matchesExactTokens, scoreTokenMatch }
