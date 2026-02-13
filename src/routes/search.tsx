import { createFileRoute, redirect } from '@tanstack/react-router'
import { detectSiteMode } from '../lib/site'

export const Route = createFileRoute('/search')({
  validateSearch: (search) => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
    highlighted: search.highlighted === '1' || search.highlighted === 'true' ? true : undefined,
  }),
  beforeLoad: ({ search, location }) => {
    const hostname =
      (location as { url?: URL }).url?.hostname ??
      (typeof window !== 'undefined' ? window.location.hostname : undefined)
    const mode = detectSiteMode(hostname)
    if (mode === 'skills') {
      throw redirect({
        to: '/skills',
        search: {
          q: search.q || undefined,
          sort: undefined,
          dir: undefined,
          highlighted: search.highlighted || undefined,
          view: undefined,
        },
        replace: true,
      })
    }

    throw redirect({
      to: '/',
      search: {
        q: search.q || undefined,
        highlighted: undefined,
        search: search.q ? undefined : true,
      },
      replace: true,
    })
  },
})
