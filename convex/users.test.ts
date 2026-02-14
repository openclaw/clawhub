import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/access', async () => {
  const actual = await vi.importActual<typeof import('./lib/access')>('./lib/access')
  return { ...actual, requireUser: vi.fn() }
})

const { requireUser } = await import('./lib/access')
const { ensureHandler } = await import('./users')

function makeCtx() {
  const patch = vi.fn()
  const get = vi.fn()
  return { ctx: { db: { patch, get } } as never, patch, get }
}

describe('ensureHandler', () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset()
  })

  it('updates handle and display name when GitHub login changes', async () => {
    const { ctx, patch } = makeCtx()
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:1',
      user: {
        _creationTime: 1,
        handle: 'old-handle',
        displayName: 'old-handle',
        name: 'new-handle',
        email: 'old@example.com',
        role: 'user',
        createdAt: 1,
      },
    } as never)

    await ensureHandler(ctx)

    expect(patch).toHaveBeenCalledWith('users:1', {
      handle: 'new-handle',
      displayName: 'new-handle',
      updatedAt: expect.any(Number),
    })
  })

  it('does not override a custom display name when syncing handle', async () => {
    const { ctx, patch } = makeCtx()
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:2',
      user: {
        _creationTime: 1,
        handle: 'old-handle',
        displayName: 'Custom Name',
        name: 'new-handle',
        role: 'user',
        createdAt: 1,
      },
    } as never)

    await ensureHandler(ctx)

    expect(patch).toHaveBeenCalledWith('users:2', {
      handle: 'new-handle',
      updatedAt: expect.any(Number),
    })
  })

  it('fills display name from existing handle when missing', async () => {
    const { ctx, patch } = makeCtx()
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:3',
      user: {
        _creationTime: 1,
        handle: 'steady-handle',
        displayName: undefined,
        name: undefined,
        email: undefined,
        role: 'user',
        createdAt: 1,
      },
    } as never)

    await ensureHandler(ctx)

    expect(patch).toHaveBeenCalledWith('users:3', {
      displayName: 'steady-handle',
      updatedAt: expect.any(Number),
    })
  })
})
