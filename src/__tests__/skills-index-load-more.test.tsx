/* @vitest-environment jsdom */
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillsIndex } from '../routes/skills/index'

const navigateMock = vi.fn()
const useActionMock = vi.fn()
const usePaginatedQueryMock = vi.fn()
let searchMock: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (_config: { component: unknown; validateSearch: unknown }) => ({
    useNavigate: () => navigateMock,
    useSearch: () => searchMock,
  }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}))

vi.mock('convex/react', () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}))

describe('SkillsIndex load-more observer', () => {
  beforeEach(() => {
    usePaginatedQueryMock.mockReset()
    useActionMock.mockReset()
    navigateMock.mockReset()
    searchMock = {}
    useActionMock.mockReturnValue(() => Promise.resolve([]))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('triggers one request for repeated intersection callbacks', async () => {
    const loadMorePaginated = vi.fn()
    usePaginatedQueryMock.mockReturnValue({
      results: [makeListResult('skill-0', 'Skill 0')],
      status: 'CanLoadMore',
      loadMore: loadMorePaginated,
    })

    type ObserverInstance = {
      callback: IntersectionObserverCallback
      observe: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }

    const observers: ObserverInstance[] = []
    class IntersectionObserverMock {
      callback: IntersectionObserverCallback
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
      takeRecords = vi.fn(() => [])
      root = null
      rootMargin = '0px'
      thresholds: number[] = []

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
        observers.push(this)
      }
    }
    vi.stubGlobal(
      'IntersectionObserver',
      IntersectionObserverMock as unknown as typeof IntersectionObserver,
    )

    render(<SkillsIndex />)

    expect(observers).toHaveLength(1)
    const observer = observers[0]
    const entries = [{ isIntersecting: true }] as Array<IntersectionObserverEntry>

    await act(async () => {
      observer.callback(entries, observer as unknown as IntersectionObserver)
      observer.callback(entries, observer as unknown as IntersectionObserver)
      observer.callback(entries, observer as unknown as IntersectionObserver)
    })

    expect(loadMorePaginated).toHaveBeenCalledTimes(1)
  })
})

function makeListResult(slug: string, displayName: string) {
  return {
    skill: {
      _id: `skill_${slug}`,
      slug,
      displayName,
      summary: `${displayName} summary`,
      tags: {},
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 1,
        comments: 0,
      },
      createdAt: 0,
      updatedAt: 0,
    },
    latestVersion: null,
    ownerHandle: null,
  }
}
