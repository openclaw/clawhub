import { describe, expect, it, vi } from 'vitest'
import { insertVersion } from './souls'

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>
}

const insertVersionHandler = (insertVersion as unknown as WrappedHandler<Record<string, unknown>>)
  ._handler

describe('souls.insertVersion', () => {
  it('throws a soul-specific ownership error for non-owners', async () => {
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === 'users:caller') return { _id: 'users:caller', deletedAt: undefined }
        return null
      }),
      query: vi.fn((table: string) => {
        if (table !== 'souls') throw new Error(`unexpected table ${table}`)
        return {
          withIndex: (name: string) => {
            if (name !== 'by_slug') throw new Error(`unexpected index ${name}`)
            return {
              order: () => ({
                take: async () => [
                  {
                    _id: 'souls:1',
                    slug: 'demo-soul',
                    ownerUserId: 'users:owner',
                    softDeletedAt: undefined,
                  },
                ],
              }),
            }
          },
        }
      }),
    }

    await expect(
      insertVersionHandler(
        { db } as never,
        {
          userId: 'users:caller',
          slug: 'demo-soul',
          displayName: 'Demo Soul',
          version: '1.0.0',
          changelog: 'Initial',
          changelogSource: 'user',
          tags: ['latest'],
          fingerprint: 'f'.repeat(64),
          files: [
            {
              path: 'SOUL.md',
              size: 100,
              storageId: '_storage:1',
              sha256: 'a'.repeat(64),
              contentType: 'text/markdown',
            },
          ],
          parsed: {
            frontmatter: {},
            metadata: {},
          },
          embedding: [0.1, 0.2],
        } as never,
      ),
    ).rejects.toThrow('Only the owner can publish soul updates')
  })
})
