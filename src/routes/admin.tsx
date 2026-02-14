import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin')({
  beforeLoad: () => {
    throw redirect({
      to: '/management',
      search: { skill: undefined },
      replace: true,
    })
  },
})
