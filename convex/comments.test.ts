/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/access', () => ({
  assertModerator: vi.fn(),
  requireUser: vi.fn(),
}))

vi.mock('./skillStatEvents', () => ({
  insertStatEvent: vi.fn(),
}))

const { requireUser, assertModerator } = await import('./lib/access')
const { insertStatEvent } = await import('./skillStatEvents')
const { addHandler, removeHandler } = await import('./comments.handlers')

describe('comments mutations', () => {
  afterEach(() => {
    vi.mocked(assertModerator).mockReset()
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

    await addHandler(ctx, { skillId: 'skills:1', body: ' hello ' } as never)

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

    await removeHandler(ctx, { commentId: 'comments:1' } as never)

    expect(patch).toHaveBeenCalledTimes(1)
    const deletePatch = vi.mocked(patch).mock.calls[0]?.[1] as Record<string, unknown>
    expect(deletePatch.updatedAt).toBeUndefined()
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: 'skills:1',
      kind: 'uncomment',
    })
  })

  it('remove rejects non-owner without moderator permission', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:3',
      user: { _id: 'users:3', role: 'user' },
    } as never)
    vi.mocked(assertModerator).mockImplementation(() => {
      throw new Error('Moderator role required')
    })

    const comment = {
      _id: 'comments:2',
      skillId: 'skills:2',
      userId: 'users:9',
      softDeletedAt: undefined,
    }
    const get = vi.fn().mockResolvedValue(comment)
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await expect(removeHandler(ctx, { commentId: 'comments:2' } as never)).rejects.toThrow(
      'Moderator role required',
    )
    expect(patch).not.toHaveBeenCalled()
    expect(insertStatEvent).not.toHaveBeenCalled()
  })

  it('remove no-ops for soft-deleted comment', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:4',
      user: { _id: 'users:4', role: 'moderator' },
    } as never)

    const comment = {
      _id: 'comments:3',
      skillId: 'skills:3',
      userId: 'users:4',
      softDeletedAt: 123,
    }
    const get = vi.fn().mockResolvedValue(comment)
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await removeHandler(ctx, { commentId: 'comments:3' } as never)

    expect(patch).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(insertStatEvent).not.toHaveBeenCalled()
  })
})
