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
  redirect: (options: unknown) => ({ redirect: options }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}))

vi.mock('convex/react', () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
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
      { sort: 'downloads', dir: 'desc', highlightedOnly: false, nonSuspiciousOnly: false },
      { initialNumItems: 25 },
    )
  })

  it('renders an empty state when no skills are returned', () => {
    render(<SkillsIndex />)
    expect(screen.getByText('No skills match that filter.')).toBeTruthy()
  })

  it('shows loading state instead of empty state when pagination is not exhausted', () => {
    // When status is not 'Exhausted', we should show loading, not "No skills match"
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'CanLoadMore',
      loadMore: vi.fn(),
    })
    render(<SkillsIndex />)
    expect(screen.getByText('Loading skills…')).toBeTruthy()
    expect(screen.queryByText('No skills match that filter.')).toBeNull()
  })

  it('keeps load-more reachable when results are empty but pagination can continue', () => {
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'CanLoadMore',
      loadMore: vi.fn(),
    })
    render(<SkillsIndex />)
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy()
  })

  it('shows loading indicator during pagination instead of hiding load more', () => {
    // When status is 'LoadingMore', keep showing the load more area with loading text
    const mockEntry = {
      skill: {
        _id: 'test-id',
        slug: 'test-skill',
        displayName: 'Test Skill',
        stats: { downloads: 0, installsAllTime: 0, stars: 0 },
      },
      latestVersion: null,
      owner: null,
      ownerHandle: null,
    }
    usePaginatedQueryMock.mockReturnValue({
      results: [mockEntry],
      status: 'LoadingMore',
      loadMore: vi.fn(),
    })
    render(<SkillsIndex />)
    // The load more button should still be visible with loading state
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('handles LoadingMore with empty results gracefully', () => {
    // Edge case: user changes filter while loading more, results become empty
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'LoadingMore',
      loadMore: vi.fn(),
    })
    render(<SkillsIndex />)
    // Should show loading message, not "No skills match"
    expect(screen.getByText('Loading skills…')).toBeTruthy()
    expect(screen.queryByText('No skills match that filter.')).toBeNull()
    // Keep the pagination control mounted so loading can continue.
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows empty state immediately when search returns no results', async () => {
    // When searching and results are empty, show "No skills match" not "Loading"
    // This tests the hasQuery condition in the empty state logic
    searchMock = { q: 'nonexistent-skill-xyz' }
    const actionFn = vi.fn().mockResolvedValue([])
    useActionMock.mockReturnValue(actionFn)
    // Pagination is skipped in search mode, so status stays 'LoadingFirstPage'
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: 'LoadingFirstPage',
      loadMore: vi.fn(),
    })
    vi.useFakeTimers()

    render(<SkillsIndex />)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    // Should show empty state, not loading
    expect(screen.getByText('No skills match that filter.')).toBeTruthy()
    expect(screen.queryByText('Loading skills…')).toBeNull()
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
      nonSuspiciousOnly: false,
      limit: 25,
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(actionFn).toHaveBeenCalledWith({
      query: 'remind',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
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
      nonSuspiciousOnly: false,
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

  it('uses relevance as default sort when searching', async () => {
    searchMock = { q: 'notion' }
    const actionFn = vi
      .fn()
      .mockResolvedValue([
        makeSearchResult('newer-low-score', 'Newer Low Score', 0.1, 2000),
        makeSearchResult('older-high-score', 'Older High Score', 0.9, 1000),
      ])
    useActionMock.mockReturnValue(actionFn)
    vi.useFakeTimers()

    render(<SkillsIndex />)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const titles = Array.from(
      document.querySelectorAll('.skills-row-title > span:first-child'),
    ).map((node) => node.textContent)

    expect(titles[0]).toBe('Older High Score')
    expect(titles[1]).toBe('Newer Low Score')
  })

  it('passes nonSuspiciousOnly to list query when filter is active', () => {
    searchMock = { nonSuspicious: true }
    render(<SkillsIndex />)

    expect(usePaginatedQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      { sort: 'downloads', dir: 'desc', highlightedOnly: false, nonSuspiciousOnly: true },
      { initialNumItems: 25 },
    )
  })

  it('passes highlightedOnly to list query when filter is active', () => {
    searchMock = { highlighted: true }
    render(<SkillsIndex />)

    expect(usePaginatedQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      { sort: 'downloads', dir: 'desc', highlightedOnly: true, nonSuspiciousOnly: false },
      { initialNumItems: 25 },
    )
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

function makeSearchResult(slug: string, displayName: string, score: number, createdAt: number) {
  return {
    score,
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
      createdAt,
      updatedAt: createdAt,
    },
    version: null,
  }
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
