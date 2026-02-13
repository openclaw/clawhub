import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { beforeLoad?: unknown }) => ({ __config: config }),
  redirect: (options: unknown) => ({ redirect: options }),
}))

import { Route } from '../routes/search'

function runBeforeLoad(search: { q?: string; highlighted?: boolean }, hostname = 'clawdhub.com') {
  const route = Route as unknown as {
    __config: {
      beforeLoad?: (args: {
        search: { q?: string; highlighted?: boolean }
        location: { url: URL }
      }) => void
    }
  }
  const beforeLoad = route.__config.beforeLoad as (args: {
    search: { q?: string; highlighted?: boolean }
    location: { url: URL }
  }) => void
  let thrown: unknown

  try {
    beforeLoad({ search, location: { url: new URL(`https://${hostname}/search`) } })
  } catch (error) {
    thrown = error
  }

  return thrown
}

describe('search route', () => {
  it('redirects skills host to the skills index', () => {
    expect(runBeforeLoad({ q: 'crab', highlighted: true }, 'clawdhub.com')).toEqual({
      redirect: {
        to: '/skills',
        search: {
          q: 'crab',
          sort: undefined,
          dir: undefined,
          highlighted: true,
          view: undefined,
        },
        replace: true,
      },
    })
  })

  it('redirects souls host with query to home search', () => {
    expect(runBeforeLoad({ q: 'crab', highlighted: true }, 'onlycrabs.ai')).toEqual({
      redirect: {
        to: '/',
        search: {
          q: 'crab',
          highlighted: undefined,
          search: undefined,
        },
        replace: true,
      },
    })
  })

  it('redirects souls host without query to home with search mode', () => {
    expect(runBeforeLoad({}, 'onlycrabs.ai')).toEqual({
      redirect: {
        to: '/',
        search: {
          q: undefined,
          highlighted: undefined,
          search: true,
        },
        replace: true,
      },
    })
  })
})
