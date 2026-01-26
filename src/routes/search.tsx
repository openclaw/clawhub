import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSiteMode } from '../lib/site'

export const Route = createFileRoute('/search')({
  validateSearch: (search) => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
    highlighted: search.highlighted === '1' || search.highlighted === 'true' ? true : undefined,
  }),
  beforeLoad: ({ search }) => {
    const mode = getSiteMode()
    switch (mode) {
      case 'souls':
        throw redirect({
          to: '/',
          search: {
            q: search.q || undefined,
            highlighted: undefined,
            search: search.q ? undefined : true,
          },
          replace: true,
        })
      case 'skills':
        throw redirect({
          to: '/skills',
          search: {
            q: search.q || undefined,
            highlighted: search.highlighted || undefined,
          },
          replace: true,
        })
      default:
        throw redirect({
          to: '/',
          search: {
            q: search.q || undefined,
            highlighted: undefined,
            search: search.q ? undefined : true,
          },
          replace: true,
        })
    }
  },
})
