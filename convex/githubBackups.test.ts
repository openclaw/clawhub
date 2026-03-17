import { describe, expect, it, vi } from 'vitest'
import { getGitHubBackupPageInternal } from './githubBackups'

const handler = (getGitHubBackupPageInternal as unknown as { _handler: Function })._handler

describe('githubBackups page filtering', () => {
  it('skips non-public digests (soft-deleted, hidden, removed)', async () => {
    const activeDigest = {
      _id: 'skillSearchDigest:active',
      skillId: 'skills:active',
      slug: 'active-skill',
      displayName: 'Active Skill',
      ownerUserId: 'users:active',
      ownerHandle: 'alice',
      latestVersionId: 'skillVersions:active',
      latestVersionSummary: { version: '1.0.0', createdAt: 1_700_000_000_000, changelog: 'init' },
      softDeletedAt: undefined,
      moderationStatus: 'active',
    }

    const hiddenDigest = {
      _id: 'skillSearchDigest:hidden',
      skillId: 'skills:hidden',
      slug: 'hidden-skill',
      displayName: 'Hidden Skill',
      ownerUserId: 'users:hidden',
      ownerHandle: 'bob',
      latestVersionId: 'skillVersions:hidden',
      latestVersionSummary: { version: '1.0.0', createdAt: 1_700_000_000_000, changelog: 'init' },
      softDeletedAt: undefined,
      moderationStatus: 'hidden',
    }

    const removedDigest = {
      _id: 'skillSearchDigest:removed',
      skillId: 'skills:removed',
      slug: 'removed-skill',
      displayName: 'Removed Skill',
      ownerUserId: 'users:removed',
      ownerHandle: 'carol',
      latestVersionId: 'skillVersions:removed',
      latestVersionSummary: { version: '1.0.0', createdAt: 1_700_000_000_000, changelog: 'init' },
      softDeletedAt: undefined,
      moderationStatus: 'removed',
    }

    const softDeletedDigest = {
      _id: 'skillSearchDigest:soft',
      skillId: 'skills:soft',
      slug: 'soft-skill',
      displayName: 'Soft Skill',
      ownerUserId: 'users:soft',
      ownerHandle: 'dave',
      latestVersionId: 'skillVersions:soft',
      latestVersionSummary: { version: '1.0.0', createdAt: 1_700_000_000_000, changelog: 'init' },
      softDeletedAt: 1,
      moderationStatus: 'active',
    }

    const paginate = vi.fn().mockResolvedValue({
      page: [activeDigest, hiddenDigest, removedDigest, softDeletedDigest],
      isDone: true,
      continueCursor: null,
    })
    const order = vi.fn().mockReturnValue({ paginate })
    const query = vi.fn().mockReturnValue({ order })

    const result = await handler(
      { db: { query } } as never,
      { batchSize: 50 },
    )

    expect(result).toMatchObject({
      isDone: true,
      cursor: null,
      items: [
        {
          kind: 'ok',
          slug: 'active-skill',
          ownerHandle: 'alice',
          version: '1.0.0',
        },
      ],
    })
  })

  it('keeps legacy digests with undefined moderationStatus eligible', async () => {
    const legacyDigest = {
      _id: 'skillSearchDigest:legacy',
      skillId: 'skills:legacy',
      slug: 'legacy-skill',
      displayName: 'Legacy Skill',
      ownerUserId: 'users:legacy',
      ownerHandle: 'eve',
      latestVersionId: 'skillVersions:legacy',
      latestVersionSummary: { version: '2.0.0', createdAt: 1_700_000_000_100, changelog: 'update' },
      softDeletedAt: undefined,
      moderationStatus: undefined,
    }

    const paginate = vi.fn().mockResolvedValue({
      page: [legacyDigest],
      isDone: true,
      continueCursor: null,
    })
    const order = vi.fn().mockReturnValue({ paginate })
    const query = vi.fn().mockReturnValue({ order })

    const result = await handler(
      { db: { query } } as never,
      {},
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      kind: 'ok',
      slug: 'legacy-skill',
      ownerHandle: 'eve',
      version: '2.0.0',
    })
  })

  it('skips digests without ownerHandle or latestVersionSummary', async () => {
    const noOwnerHandle = {
      _id: 'skillSearchDigest:noowner',
      skillId: 'skills:noowner',
      slug: 'no-owner',
      displayName: 'No Owner',
      ownerUserId: 'users:noowner',
      ownerHandle: undefined,
      latestVersionId: 'skillVersions:noowner',
      latestVersionSummary: { version: '1.0.0', createdAt: 1, changelog: 'init' },
      softDeletedAt: undefined,
      moderationStatus: 'active',
    }

    const noVersion = {
      _id: 'skillSearchDigest:noversion',
      skillId: 'skills:noversion',
      slug: 'no-version',
      displayName: 'No Version',
      ownerUserId: 'users:noversion',
      ownerHandle: 'frank',
      latestVersionId: undefined,
      latestVersionSummary: undefined,
      softDeletedAt: undefined,
      moderationStatus: 'active',
    }

    const paginate = vi.fn().mockResolvedValue({
      page: [noOwnerHandle, noVersion],
      isDone: true,
      continueCursor: null,
    })
    const order = vi.fn().mockReturnValue({ paginate })
    const query = vi.fn().mockReturnValue({ order })

    const result = await handler(
      { db: { query } } as never,
      {},
    )

    expect(result.items).toHaveLength(0)
  })
})
