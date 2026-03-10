import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { convex } from '../convex/client'
import { parseAuthErrorFromUrl, setAuthError } from '../lib/useAuthError'
import { UserBootstrap } from './UserBootstrap'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthProvider
      client={convex}
      replaceURL={(relativeUrl) => {
        if (typeof window !== 'undefined') {
          const authError = parseAuthErrorFromUrl(relativeUrl)
          if (authError) {
            setAuthError(authError)
          }
          window.history.replaceState(null, '', relativeUrl)
        }
      }}
    >
      <UserBootstrap />
      {children}
    </ConvexAuthProvider>
  )
}
