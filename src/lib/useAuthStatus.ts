import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'

export function useAuthStatus() {
  const me = useQuery(api.users.me) as Doc<'users'> | null | undefined
  return {
    me,
    isLoading: me === undefined,
    isAuthenticated: Boolean(me),
  }
}
