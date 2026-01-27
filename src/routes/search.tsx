import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/search')({
  validateSearch: (search) => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
    highlighted: search.highlighted === '1' || search.highlighted === 'true' ? true : undefined,
  }),
  beforeLoad: ({ search }) => {
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
  },
})
