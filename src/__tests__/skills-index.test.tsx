/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
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
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}))

vi.mock('convex/react', () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
}))

vi.mock('convex-helpers/react', () => ({
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}))

describe('SkillsIndex', () => {
  beforeEach(() => {
    usePaginatedQueryMock.mockReset()
    useActionMock.mockReset()
    navigateMock.mockReset()
    searchMock = {}
    useActionMock.mockReturnValue(() => Promise.resolve([]))
    // Default: return empty results with Exhausted status
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'Exhausted',
      loadMore: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('requests the first skills page', () => {
    render(<SkillsIndex />)
    // usePaginatedQuery should be called with the API endpoint and sort/dir args
    expect(usePaginatedQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      { sort: 'newest', dir: 'desc' },
      { initialNumItems: 25 },
    )
  })

  it('renders an empty state when no skills are returned', () => {
    render(<SkillsIndex />)
    expect(screen.getByText('No skills match that filter.')).toBeTruthy()
  })

  it('skips list query and calls search when query is set', async () => {
    searchMock = { q: 'remind' }
    const actionFn = vi.fn().mockResolvedValue([])
    useActionMock.mockReturnValue(actionFn)
    vi.useFakeTimers()

    render(<SkillsIndex />)

    // usePaginatedQuery should be called with 'skip' when there's a search query
    expect(usePaginatedQueryMock).toHaveBeenCalledWith(expect.anything(), 'skip', {
      initialNumItems: 25,
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(actionFn).toHaveBeenCalledWith({
      query: 'remind',
      highlightedOnly: false,
      limit: 25,
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(actionFn).toHaveBeenCalledWith({
      query: 'remind',
      highlightedOnly: false,
      limit: 25,
    })
  })

  it('loads more results when search pagination is requested', async () => {
    searchMock = { q: 'remind' }
    vi.stubGlobal('IntersectionObserver', undefined)
    const actionFn = vi
      .fn()
      .mockResolvedValueOnce(makeSearchResults(25))
      .mockResolvedValueOnce(makeSearchResults(50))
    useActionMock.mockReturnValue(actionFn)
    vi.useFakeTimers()

    render(<SkillsIndex />)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
    await act(async () => {
      fireEvent.click(loadMoreButton)
      await vi.runAllTimersAsync()
    })

    expect(actionFn).toHaveBeenLastCalledWith({
      query: 'remind',
      highlightedOnly: false,
      limit: 50,
    })
  })

  it('sorts search results by stars and breaks ties by updatedAt', async () => {
    searchMock = { q: 'remind', sort: 'stars', dir: 'desc' }
    const actionFn = vi
      .fn()
      .mockResolvedValue([
        makeSearchEntry({ slug: 'skill-a', displayName: 'Skill A', stars: 5, updatedAt: 100 }),
        makeSearchEntry({ slug: 'skill-b', displayName: 'Skill B', stars: 5, updatedAt: 200 }),
        makeSearchEntry({ slug: 'skill-c', displayName: 'Skill C', stars: 4, updatedAt: 999 }),
      ])
    useActionMock.mockReturnValue(actionFn)
    vi.useFakeTimers()

    render(<SkillsIndex />)
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const links = screen.getAllByRole('link')
    expect(links[0]?.textContent).toContain('Skill B')
    expect(links[1]?.textContent).toContain('Skill A')
    expect(links[2]?.textContent).toContain('Skill C')
  })
})

function makeSearchResults(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    score: 0.9,
    skill: {
      _id: `skill_${index}`,
      slug: `skill-${index}`,
      displayName: `Skill ${index}`,
      summary: `Summary ${index}`,
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
    version: null,
  }))
}

function makeSearchEntry(params: {
  slug: string
  displayName: string
  stars: number
  updatedAt: number
}) {
  return {
    score: 0.9,
    skill: {
      _id: `skill_${params.slug}`,
      slug: params.slug,
      displayName: params.displayName,
      summary: `Summary ${params.slug}`,
      tags: {},
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: params.stars,
        versions: 1,
        comments: 0,
      },
      createdAt: 0,
      updatedAt: params.updatedAt,
    },
    version: null,
  }
}
