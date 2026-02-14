import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    (config: {
      beforeLoad?: (args: { search: Record<string, unknown> }) => void
      component?: unknown
      validateSearch?: unknown
    }) => ({ __config: config }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: () => null,
}))

import { Route } from '../routes/skills/index'

function runBeforeLoad(search: Record<string, unknown>) {
  const route = Route as unknown as {
    __config: {
      beforeLoad?: (args: { search: Record<string, unknown> }) => void
    }
  }
  const beforeLoad = route.__config.beforeLoad as (args: {
    search: Record<string, unknown>
  }) => void
  let thrown: unknown

  try {
    beforeLoad({ search })
  } catch (error) {
    thrown = error
  }

  return thrown
}

describe('skills route default sort', () => {
  it('redirects browse view to downloads when sort is missing', () => {
    expect(runBeforeLoad({ nonSuspicious: true })).toEqual({
      redirect: {
        to: '/skills',
        search: {
          q: undefined,
          sort: 'downloads',
          dir: undefined,
          highlighted: undefined,
          nonSuspicious: true,
          view: undefined,
          focus: undefined,
        },
        replace: true,
      },
    })
  })

  it('does not redirect when query is present', () => {
    expect(runBeforeLoad({ q: 'notion' })).toBeUndefined()
  })
})
