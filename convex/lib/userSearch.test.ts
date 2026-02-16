import { describe, expect, it } from 'vitest'
import { buildUserSearchResults } from './userSearch'

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'users:1',
    _creationTime: 1,
    handle: 'alice',
    name: 'alice-gh',
    displayName: 'Alice',
    email: 'alice@example.com',
    ...overrides,
  } as never
}

describe('buildUserSearchResults', () => {
  it('returns all users when query is empty', () => {
    const users = [makeUser({ _id: 'users:1' }), makeUser({ _id: 'users:2', handle: 'bob' })]
    const result = buildUserSearchResults(users)
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(2)
  })

  it('matches compact handle/search variants', () => {
    const users = [makeUser({ handle: 'alice-dev' }), makeUser({ _id: 'users:2', handle: 'bob' })]
    const result = buildUserSearchResults(users, 'alicedev')
    expect(result.total).toBe(1)
    expect(result.items[0]?.handle).toBe('alice-dev')
  })

  it('does not throw on malformed legacy field types', () => {
    const users = [
      makeUser({
        _id: 'users:legacy',
        handle: 42,
        name: { bad: true },
        displayName: null,
        email: ['legacy@example.com'],
      }),
      makeUser({ _id: 'users:2', handle: 'carol' }),
    ]

    expect(() => buildUserSearchResults(users, 'car')).not.toThrow()
    const result = buildUserSearchResults(users, 'car')
    expect(result.total).toBe(1)
    expect(result.items[0]?._id).toBe('users:2')
  })

  it('ranks exact id match above fuzzy matches', () => {
    const users = [
      makeUser({ _id: 'users:target', handle: 'target-user', _creationTime: 1 }),
      makeUser({ _id: 'users:2', handle: 'users:target', _creationTime: 10 }),
    ]

    const result = buildUserSearchResults(users, 'users:target')
    expect(result.total).toBe(2)
    expect(result.items[0]?._id).toBe('users:target')
  })

  it('uses creation time as tie-break when scores are equal', () => {
    const users = [
      makeUser({ _id: 'users:older', handle: 'alpha', _creationTime: 1 }),
      makeUser({ _id: 'users:newer', handle: 'alpha-two', _creationTime: 50 }),
    ]

    const result = buildUserSearchResults(users, 'pha')
    expect(result.total).toBe(2)
    expect(result.items[0]?._id).toBe('users:newer')
    expect(result.items[1]?._id).toBe('users:older')
  })
})
