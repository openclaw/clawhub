import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import { SkillDetailPage } from '../components/SkillDetailPage'

const navigateMock = vi.fn()
const useAuthStatusMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

const useQueryMock = vi.fn()
const getReadmeMock = vi.fn()

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => vi.fn(),
  useAction: () => getReadmeMock,
}))

vi.mock('../lib/useAuthStatus', () => ({
  useAuthStatus: () => useAuthStatusMock(),
}))

describe('SkillDetailPage', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
    getReadmeMock.mockReset()
    navigateMock.mockReset()
    useAuthStatusMock.mockReset()
    getReadmeMock.mockResolvedValue({ text: '' })
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    })
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === 'skip') return undefined
      return undefined
    })
  })

  it('shows a loading indicator while loading', () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === 'skip') return undefined
      return undefined
    })

    render(<SkillDetailPage slug="weather" />)
    expect(screen.getByText(/Loading skill/i)).toBeTruthy()
    expect(screen.queryByText(/Skill not found/i)).toBeNull()
  })

  it('shows not found when skill query resolves to null', async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === 'skip') return undefined
      return null
    })

    render(<SkillDetailPage slug="missing-skill" />)
    expect(await screen.findByText(/Skill not found/i)).toBeTruthy()
  })

  it('redirects legacy routes to canonical owner/slug', async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === 'skip') return undefined
      if (args && typeof args === 'object' && 'skillId' in args) return []
      return {
        skill: {
          _id: 'skills:1',
          slug: 'weather',
          displayName: 'Weather',
          summary: 'Get current weather.',
          ownerUserId: 'users:1',
          tags: {},
          stats: { stars: 0, downloads: 0 },
        },
        owner: { handle: 'steipete', name: 'Peter' },
        latestVersion: { _id: 'skillVersions:1', version: '1.0.0', parsed: {} },
      }
    })

    render(<SkillDetailPage slug="weather" redirectToCanonical />)
    expect(screen.getByText(/Loading skill/i)).toBeTruthy()

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled()
    })
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/$owner/$slug',
      params: { owner: 'steipete', slug: 'weather' },
      replace: true,
    })
  })

  it('opens report dialog for authenticated users', async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: 'users:1', role: 'user' },
    })
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === 'skip') return undefined
      if (args && typeof args === 'object' && 'skillId' in args) return []
      if (args && typeof args === 'object' && 'slug' in args) {
        return {
          skill: {
            _id: 'skills:1',
            slug: 'weather',
            displayName: 'Weather',
            summary: 'Get current weather.',
            ownerUserId: 'users:1',
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: { handle: 'steipete', name: 'Peter' },
          latestVersion: { _id: 'skillVersions:1', version: '1.0.0', parsed: {}, files: [] },
        }
      }
      return undefined
    })

    render(<SkillDetailPage slug="weather" />)

    expect(screen.queryByText(/Reports require a reason\. Abuse may result in a ban\./i)).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: /report/i }))

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Report skill/i)).toBeTruthy()
  })
})
