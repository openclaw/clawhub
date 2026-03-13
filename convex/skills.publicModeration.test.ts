import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@convex-dev/auth/server', () => ({
  getAuthUserId: vi.fn(),
}))

vi.mock('./lib/badges', async () => {
  const actual =
    await vi.importActual<typeof import('./lib/badges')>('./lib/badges')
  return {
    ...actual,
    getSkillBadgeMap: vi.fn(async () => ({})),
  }
})

const { getAuthUserId } = await import('@convex-dev/auth/server')
const { getBySlug } = await import('./skills')

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const getBySlugHandler = (
  getBySlug as unknown as WrappedHandler<{
    slug: string
  }>
)._handler

function makeCtx(overrides?: {
  skill?: Partial<Record<string, unknown>>
}) {
  const skill = {
    _id: 'skills:1',
    _creationTime: 1,
    slug: 'padel',
    displayName: 'Padel',
    summary: 'A test skill',
    ownerUserId: 'users:owner',
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: 'skillVersions:1',
    tags: { latest: '0.1.0' },
    badges: {},
    stats: {
      downloads: 0,
      stars: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      versions: 1,
      comments: 0,
    },
    createdAt: 10,
    updatedAt: 20,
    softDeletedAt: undefined,
    moderationStatus: 'active',
    moderationReason: 'manual.override.clean',
    moderationVerdict: 'clean',
    moderationFlags: undefined,
    moderationReasonCodes: ['suspicious.dynamic_code_execution'],
    moderationSignals: {
      staticScan: {
        key: 'staticScan',
        family: 'local',
        state: 'ready',
        verdict: 'suspicious',
        contribution: 'corroborating',
        reasonCodes: ['suspicious.dynamic_code_execution'],
      },
      llmScan: {
        key: 'llmScan',
        family: 'llm',
        state: 'ready',
        verdict: 'suspicious',
        contribution: 'corroborating',
        reasonCodes: ['suspicious.llm_suspicious'],
        details: {
          guidance: 'internal guidance',
          findings: 'internal findings',
          model: 'gpt-test',
        },
      },
    },
    moderationSummary: 'Manual override (clean): internal staff note',
    moderationEngineVersion: 'v2.0.0',
    moderationEvaluatedAt: 30,
    manualOverride: {
      verdict: 'clean',
      note: 'internal staff note',
      reviewerUserId: 'users:moderator',
      updatedAt: 30,
    },
    ...overrides?.skill,
  }

  const latestVersion = {
    _id: 'skillVersions:1',
    version: '0.1.0',
  }

  const owner = {
    _id: 'users:owner',
    _creationTime: 2,
    handle: 'local',
    name: 'Local Dev',
    displayName: 'Local Dev',
    deletedAt: undefined,
    deactivatedAt: undefined,
  }

  const query = vi.fn((table: string) => {
    if (table === 'skills') {
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => skill),
        })),
      }
    }
    throw new Error(`Unexpected query table: ${table}`)
  })

  const get = vi.fn(async (id: string) => {
    if (id === 'skillVersions:1') return latestVersion
    if (id === 'users:owner') return owner
    return null
  })

  return {
    ctx: {
      db: { query, get },
    } as never,
  }
}

describe('getBySlug public moderation info', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(getAuthUserId).mockReset()
  })

  it('does not expose manual override notes to non-owners', async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null)

    const { ctx } = makeCtx()
    const result = (await getBySlugHandler(ctx, {
      slug: 'padel',
    })) as {
      moderationInfo: {
        overrideActive: boolean
        summary: string | null
        signals?: unknown
      } | null
    }

    expect(result.moderationInfo?.overrideActive).toBe(true)
    expect(result.moderationInfo?.signals).toBeUndefined()
    expect(result.moderationInfo?.summary).toBe(
      'Security findings were reviewed by staff and cleared for public use.',
    )
  })

  it('redacts moderation signal details for non-owner suspicious views', async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null)

    const { ctx } = makeCtx({
      skill: {
        moderationReason: 'scanner.llm.suspicious',
        moderationVerdict: 'suspicious',
        moderationFlags: ['flagged.suspicious'],
        moderationSummary: 'Suspicious behavior detected.',
        manualOverride: undefined,
      },
    })
    const result = (await getBySlugHandler(ctx, {
      slug: 'padel',
    })) as {
      moderationInfo: {
        signals?: {
          llmScan?: {
            details?: unknown
            verdict?: string
          }
        }
      } | null
    }

    expect(result.moderationInfo?.signals?.llmScan?.verdict).toBe('suspicious')
    expect(result.moderationInfo?.signals?.llmScan?.details).toBeUndefined()
  })
})
