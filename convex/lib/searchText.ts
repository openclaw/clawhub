const WORD_RE = /[a-z0-9]+/g

function normalize(value: string) {
  return value.toLowerCase()
}

export function tokenize(value: string): string[] {
  if (!value) return []
  return normalize(value).match(WORD_RE) ?? []
}

export function matchesExactTokens(
  queryTokens: string[],
  parts: Array<string | null | undefined>,
): boolean {
  if (queryTokens.length === 0) return false
  const text = parts.filter((part) => Boolean(part?.trim())).join(' ')
  if (!text) return false
  const textTokens = tokenize(text)
  if (textTokens.length === 0) return false
  // Require at least one token to prefix-match, allowing vector similarity to determine relevance
  return queryTokens.some((queryToken) =>
    textTokens.some((textToken) => textToken.startsWith(queryToken)),
  )
}

export const __test = { normalize, tokenize, matchesExactTokens }
