import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/access', async () => {
  const actual = await vi.importActual<typeof import('./lib/access')>('./lib/access')
  return { ...actual, requireUser: vi.fn() }
})

const { requireUser } = await import('./lib/access')
const { ensureHandler, list, searchInternal } = await import('./users')

function makeCtx() {
  const patch = vi.fn()
  const get = vi.fn()
  return { ctx: { db: { patch, get } } as never, patch, get }
}

function makeListCtx(users: Array<Record<string, unknown>>) {
  const take = vi.fn(async (n: number) => users.slice(0, n))
  const collect = vi.fn(async () => users)
  const order = vi.fn(() => ({ take, collect }))
  const query = vi.fn(() => ({ order }))
  const get = vi.fn()
  return {
    ctx: { db: { query, get } } as never,
    take,
    collect,
    order,
    query,
    get,
  }
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

  it('does not patch when user metadata is already normalized', async () => {
    const { ctx, patch, get } = makeCtx()
    get.mockResolvedValue({
      _id: 'users:4',
      handle: 'steady',
      displayName: 'Steady Name',
      name: 'steady',
      role: 'user',
      _creationTime: 1,
      createdAt: 1,
    })
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:4',
      user: {
        _creationTime: 1,
        handle: 'steady',
        displayName: 'Steady Name',
        name: 'steady',
        role: 'user',
        createdAt: 1,
      },
    } as never)

    const result = await ensureHandler(ctx)

    expect(patch).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith('users:4')
    expect(result).toMatchObject({ _id: 'users:4' })
  })

  it('sets admin role when normalized handle is steipete and role is missing', async () => {
    const { ctx, patch } = makeCtx()
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:admin',
      user: {
        _creationTime: 1,
        handle: 'steipete',
        displayName: 'steipete',
        name: 'steipete',
        role: undefined,
        createdAt: 1,
      },
    } as never)

    await ensureHandler(ctx)

    expect(patch).toHaveBeenCalledWith('users:admin', {
      displayName: 'steipete',
      role: 'admin',
      updatedAt: expect.any(Number),
    })
  })

  it('derives handle/display name from email when missing', async () => {
    const { ctx, patch } = makeCtx()
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:email',
      user: {
        _creationTime: 1,
        handle: undefined,
        displayName: undefined,
        name: undefined,
        email: 'owner@example.com',
        role: undefined,
        createdAt: undefined,
      },
    } as never)

    await ensureHandler(ctx)

    expect(patch).toHaveBeenCalledWith('users:email', {
      handle: 'owner',
      displayName: 'owner',
      role: 'user',
      createdAt: 1,
      updatedAt: expect.any(Number),
    })
  })
})

describe('users.list', () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset()
  })

  it('uses take(limit) without full collect when search is empty', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)
    const users = [
      { _id: 'users:1', _creationTime: 3, handle: 'alice', role: 'user' },
      { _id: 'users:2', _creationTime: 2, handle: 'bob', role: 'user' },
      { _id: 'users:3', _creationTime: 1, handle: 'carol', role: 'user' },
    ]
    const { ctx, take, collect } = makeListCtx(users)
    const listHandler = (list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler

    const result = (await listHandler(ctx, { limit: 2 })) as {
      items: Array<Record<string, unknown>>
      total: number
    }

    expect(take).toHaveBeenCalledWith(2)
    expect(collect).not.toHaveBeenCalled()
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(2)
  })

  it('uses bounded scan for search instead of full collect', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)
    const users = [
      { _id: 'users:1', _creationTime: 3, handle: 'alice', role: 'user' },
      { _id: 'users:2', _creationTime: 2, handle: 'bob', role: 'user' },
      { _id: 'users:3', _creationTime: 1, handle: 'carol', role: 'user' },
    ]
    const { ctx, take, collect } = makeListCtx(users)
    const listHandler = (list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler

    const result = (await listHandler(ctx, { limit: 50, search: 'ali' })) as {
      items: Array<Record<string, unknown>>
      total: number
    }

    expect(take).toHaveBeenCalledWith(500)
    expect(collect).not.toHaveBeenCalled()
    expect(result.total).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.handle).toBe('alice')
  })

  it('clamps large limit and search scan size', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)
    const users = Array.from({ length: 8_000 }, (_value, index) => ({
      _id: `users:${index}`,
      _creationTime: 10_000 - index,
      handle: `user-${index}`,
      role: 'user',
    }))
    const { ctx, take } = makeListCtx(users)
    const listHandler = (list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler

    await listHandler(ctx, { limit: 999, search: 'user' })

    expect(take).toHaveBeenCalledWith(2_000)
  })

  it('handles malformed legacy user fields without throwing', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)
    const users = [
      {
        _id: 'users:legacy',
        _creationTime: 99,
        handle: 123,
        name: { broken: true },
        displayName: null,
        email: ['legacy@example.com'],
        role: 'user',
      },
      {
        _id: 'users:2',
        _creationTime: 98,
        handle: 'carol',
        role: 'user',
      },
    ]
    const { ctx } = makeListCtx(users)
    const listHandler = (list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler

    await expect(listHandler(ctx, { limit: 50, search: 'car' })).resolves.toMatchObject({
      total: 1,
      items: [{ _id: 'users:2' }],
    })
  })

  it('treats whitespace search as empty search', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)
    const users = [
      { _id: 'users:1', _creationTime: 2, handle: 'alice', role: 'user' },
      { _id: 'users:2', _creationTime: 1, handle: 'bob', role: 'user' },
    ]
    const { ctx, take, collect } = makeListCtx(users)
    const listHandler = (list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler

    const result = (await listHandler(ctx, { limit: 50, search: '   ' })) as {
      items: Array<Record<string, unknown>>
      total: number
    }

    expect(take).toHaveBeenCalledWith(50)
    expect(collect).not.toHaveBeenCalled()
    expect(result.total).toBe(2)
  })

  it('clamps non-positive limit to one', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)
    const users = [
      { _id: 'users:1', _creationTime: 2, handle: 'alice', role: 'user' },
      { _id: 'users:2', _creationTime: 1, handle: 'bob', role: 'user' },
    ]
    const { ctx, take } = makeListCtx(users)
    const listHandler = (list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler

    const result = (await listHandler(ctx, { limit: 0 })) as {
      items: Array<Record<string, unknown>>
      total: number
    }

    expect(take).toHaveBeenCalledWith(1)
    expect(result.total).toBe(1)
    expect(result.items).toHaveLength(1)
  })

  it('rejects non-admin actors', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:basic',
      user: { _id: 'users:basic', role: 'user' },
    } as never)
    const { ctx } = makeListCtx([])
    const listHandler = (list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler

    await expect(listHandler(ctx, { limit: 10 })).rejects.toThrow('Forbidden')
  })
})

describe('users.searchInternal', () => {
  it('rejects missing actor', async () => {
    const { ctx, get } = makeListCtx([])
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler
    get.mockResolvedValue(null)

    await expect(handler(ctx, { actorUserId: 'users:missing' })).rejects.toThrow('Unauthorized')
  })

  it('uses bounded scan and returns mapped fields', async () => {
    const users = [
      { _id: 'users:1', _creationTime: 2, handle: 'alice', name: 'alice', role: 'user' },
      { _id: 'users:2', _creationTime: 1, handle: 'bob', name: 'bob', role: 'moderator' },
    ]
    const { ctx, take, collect, get } = makeListCtx(users)
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler
    get.mockResolvedValue({ _id: 'users:admin', role: 'admin' })

    const result = (await handler(ctx, {
      actorUserId: 'users:admin',
      query: 'ali',
      limit: 25,
    })) as {
      items: Array<Record<string, unknown>>
      total: number
    }

    expect(take).toHaveBeenCalledWith(500)
    expect(collect).not.toHaveBeenCalled()
    expect(result.total).toBe(1)
    expect(result.items).toEqual([
      {
        userId: 'users:1',
        handle: 'alice',
        displayName: null,
        name: 'alice',
        role: 'user',
      },
    ])
  })

  it('rejects deactivated actors', async () => {
    const { ctx, get } = makeListCtx([])
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler
    get.mockResolvedValue({ _id: 'users:ghost', role: 'admin', deactivatedAt: Date.now() })

    await expect(handler(ctx, { actorUserId: 'users:ghost' })).rejects.toThrow('Unauthorized')
  })

  it('rejects non-admin actors', async () => {
    const { ctx, get } = makeListCtx([])
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler
    get.mockResolvedValue({ _id: 'users:mod', role: 'moderator' })

    await expect(handler(ctx, { actorUserId: 'users:mod', query: 'a' })).rejects.toThrow(
      'Forbidden',
    )
  })

  it('clamps limit for empty query and uses non-search path', async () => {
    const users = Array.from({ length: 400 }, (_value, index) => ({
      _id: `users:${index}`,
      _creationTime: 1_000 - index,
      handle: `user-${index}`,
      role: 'user',
    }))
    const { ctx, take, collect, get } = makeListCtx(users)
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler
    get.mockResolvedValue({ _id: 'users:admin', role: 'admin' })

    const result = (await handler(ctx, {
      actorUserId: 'users:admin',
      limit: 999,
      query: '   ',
    })) as { items: Array<Record<string, unknown>>; total: number }

    expect(take).toHaveBeenCalledWith(200)
    expect(collect).not.toHaveBeenCalled()
    expect(result.total).toBe(200)
    expect(result.items).toHaveLength(200)
  })
})
