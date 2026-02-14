/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/access', () => ({
  assertModerator: vi.fn(),
  requireUser: vi.fn(),
}))

vi.mock('./skillStatEvents', () => ({
  insertStatEvent: vi.fn(),
}))

const { requireUser } = await import('./lib/access')
const { insertStatEvent } = await import('./skillStatEvents')
const { __test } = await import('./comments')

describe('comments mutations', () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset()
    vi.mocked(insertStatEvent).mockReset()
  })

  it('add avoids direct skill patch and records stat event', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:1',
      user: { _id: 'users:1', role: 'user' },
    } as never)

    const get = vi.fn().mockResolvedValue({
      _id: 'skills:1',
    })
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await __test.addHandler(ctx, { skillId: 'skills:1', body: ' hello ' } as never)

    expect(patch).not.toHaveBeenCalled()
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: 'skills:1',
      kind: 'comment',
    })
  })

  it('remove keeps comment soft-delete patch free of updatedAt', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:2',
      user: { _id: 'users:2', role: 'moderator' },
    } as never)

    const comment = {
      _id: 'comments:1',
      skillId: 'skills:1',
      userId: 'users:2',
      softDeletedAt: undefined,
    }
    const get = vi.fn(async (id: string) => {
      if (id === 'comments:1') return comment
      return null
    })
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await __test.removeHandler(ctx, { commentId: 'comments:1' } as never)

    expect(patch).toHaveBeenCalledTimes(1)
    const deletePatch = vi.mocked(patch).mock.calls[0]?.[1] as Record<string, unknown>
    expect(deletePatch.updatedAt).toBeUndefined()
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: 'skills:1',
      kind: 'uncomment',
    })
  })
})
