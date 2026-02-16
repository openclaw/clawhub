import type { Doc } from '../_generated/dataModel'

type UserSearchResult = {
  items: Doc<'users'>[]
  total: number
}

type UserSearchMatch = {
  user: Doc<'users'>
  score: number
}

function normalizeCompact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function toSearchText(value: unknown) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function scoreUser(user: Doc<'users'>, query: string, compactQuery: string) {
  const handle = toSearchText(user.handle)
  const name = toSearchText(user.name)
  const displayName = toSearchText(user.displayName)
  const email = toSearchText(user.email)
  const id = String(user._id).toLowerCase()

  let score = 0

  if (id === query) score = Math.max(score, 100)
  if (handle === query) score = Math.max(score, 96)
  if (displayName === query || name === query) score = Math.max(score, 90)

  if (handle.startsWith(query)) score = Math.max(score, 82)
  if (displayName.startsWith(query) || name.startsWith(query)) score = Math.max(score, 72)

  if (handle.includes(query)) score = Math.max(score, 62)
  if (displayName.includes(query) || name.includes(query)) score = Math.max(score, 52)
  if (email.includes(query)) score = Math.max(score, 42)
  if (id.includes(query)) score = Math.max(score, 40)

  if (compactQuery.length >= 2) {
    const compactHandle = normalizeCompact(handle)
    const compactName = normalizeCompact(displayName || name)
    if (compactHandle === compactQuery) score = Math.max(score, 88)
    if (compactHandle.includes(compactQuery)) score = Math.max(score, 58)
    if (compactName.includes(compactQuery)) score = Math.max(score, 48)
  }

  return score
}

export function buildUserSearchResults(users: Doc<'users'>[], query?: string): UserSearchResult {
  const trimmed = query?.trim() ?? ''
  if (!trimmed) return { items: users, total: users.length }

  const normalized = trimmed.toLowerCase()
  const compactQuery = normalizeCompact(normalized)
  const matches: UserSearchMatch[] = []

  for (const user of users) {
    const score = scoreUser(user, normalized, compactQuery)
    if (score > 0) matches.push({ user, score })
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.user._creationTime - a.user._creationTime
  })

  return { items: matches.map((entry) => entry.user), total: matches.length }
}
