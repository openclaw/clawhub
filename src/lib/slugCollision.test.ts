import { describe, expect, it } from 'vitest'
import { getPublicSlugCollision } from './slugCollision'

describe('getPublicSlugCollision', () => {
  it('returns null when current user is not yet known', () => {
    expect(
      getPublicSlugCollision({
        isSoulMode: false,
        slug: 'demo',
        meUserId: null,
        result: {
          skill: { slug: 'demo', ownerUserId: 'users:other' },
          owner: { handle: 'alice', _id: 'users:other' },
        },
      }),
    ).toBeNull()
  })

  it('returns null when no skill exists for slug', () => {
    expect(
      getPublicSlugCollision({
        isSoulMode: false,
        slug: 'demo',
        meUserId: 'users:me',
        result: null,
      }),
    ).toBeNull()
  })

  it('returns null when slug belongs to current user', () => {
    expect(
      getPublicSlugCollision({
        isSoulMode: false,
        slug: 'demo',
        meUserId: 'users:me',
        result: {
          skill: { slug: 'demo', ownerUserId: 'users:me' },
          owner: { handle: 'me', _id: 'users:me' },
        },
      }),
    ).toBeNull()
  })

  it('returns collision with link for public taken slug', () => {
    expect(
      getPublicSlugCollision({
        isSoulMode: false,
        slug: 'demo',
        meUserId: 'users:me',
        result: {
          skill: { slug: 'demo', ownerUserId: 'users:other' },
          owner: { handle: 'alice', _id: 'users:other' },
        },
      }),
    ).toEqual({
      message: 'Slug is already taken. Choose a different slug.',
      url: '/alice/demo',
    })
  })
})
