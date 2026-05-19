const AUTH_REDIRECT_ATTEMPT_KEY = "clawhub.authRedirectAttempt";
const AUTH_REDIRECT_ATTEMPT_TTL_MS = 10 * 60 * 1000;

type AuthRedirectAttempt = {
  provider: string;
  redirectTo: string;
  startedAt: number;
};

function getStorage() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

export function markAuthRedirectAttempt(provider: string, redirectTo: string) {
  try {
    getStorage()?.setItem(
      AUTH_REDIRECT_ATTEMPT_KEY,
      JSON.stringify({ provider, redirectTo, startedAt: Date.now() } satisfies AuthRedirectAttempt),
    );
  } catch {
    // Session storage is best-effort; auth should still proceed if unavailable.
  }
}

export function clearAuthRedirectAttempt() {
  try {
    getStorage()?.removeItem(AUTH_REDIRECT_ATTEMPT_KEY);
  } catch {
    // ignore
  }
}

export function getActiveAuthRedirectAttempt() {
  try {
    const raw = getStorage()?.getItem(AUTH_REDIRECT_ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthRedirectAttempt>;
    if (
      typeof parsed.provider !== "string" ||
      typeof parsed.redirectTo !== "string" ||
      typeof parsed.startedAt !== "number"
    ) {
      clearAuthRedirectAttempt();
      return null;
    }
    if (Date.now() - parsed.startedAt > AUTH_REDIRECT_ATTEMPT_TTL_MS) {
      clearAuthRedirectAttempt();
      return null;
    }
    return parsed as AuthRedirectAttempt;
  } catch {
    clearAuthRedirectAttempt();
    return null;
  }
}
