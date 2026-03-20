import { useSyncExternalStore } from "react";

// Tiny external store for auth errors raised during sign-in.
let authError: string | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAuthErrorSnapshot() {
  return authError;
}

export function setAuthError(error: string | null) {
  if (authError === error) return;
  authError = error;
  emitChange();
}

export function clearAuthError() {
  setAuthError(null);
}

export function useAuthError() {
  const error = useSyncExternalStore(subscribe, getAuthErrorSnapshot, getAuthErrorSnapshot);
  return { error, clear: clearAuthError };
}
