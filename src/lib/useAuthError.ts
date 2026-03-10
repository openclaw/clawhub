import { useSyncExternalStore } from 'react'

/**
 * Tiny external store for auth errors surfaced via the OAuth callback URL.
 *
 * When ConvexAuthProvider's `replaceURL` callback detects an error parameter
 * in the hash fragment (e.g. `#error=Your+account+has+been+banned...`), it
 * writes the message here so any component can display it.
 */
let authError: string | null = null
const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return authError
}

export function setAuthError(error: string | null) {
  if (authError === error) return
  authError = error
  emitChange()
}

export function clearAuthError() {
  setAuthError(null)
}

/**
 * Parse an auth error from a relative URL's hash fragment.
 *
 * Convex Auth encodes callback errors as `#error=<message>` or
 * `#error_description=<message>` in the redirect URL.
 */
export function parseAuthErrorFromUrl(relativeUrl: string): string | null {
  const hashIndex = relativeUrl.indexOf('#')
  if (hashIndex === -1) return null
  const params = new URLSearchParams(relativeUrl.slice(hashIndex + 1))
  return params.get('error_description') ?? params.get('error') ?? null
}

export function useAuthError() {
  const error = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { error, clear: clearAuthError }
}
