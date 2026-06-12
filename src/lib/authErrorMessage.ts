import { getUserFacingConvexError } from "./convexError";

export const CLAWHUB_ACCOUNT_ISSUE_URL = "https://github.com/openclaw/clawhub/issues/new";
export const CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT = "open a GitHub issue";
export const ACCOUNT_APPEAL_URL = "https://appeals.openclaw.ai/";
export const ACCOUNT_APPEAL_LINK_TEXT = "appeal this decision";
export const BANNED_ACCOUNT_PATH = "/account-banned";

export const BANNED_SIGN_IN_MESSAGE = `This ClawHub account is not in good standing and cannot sign in. Please ${ACCOUNT_APPEAL_LINK_TEXT} if you believe this is a mistake.`;
export const DELETED_SIGN_IN_MESSAGE =
  "This ClawHub account was permanently deleted and cannot sign in again.";
export const ACCESS_DENIED_SIGN_IN_MESSAGE = `Sign in was denied. Please try signing in with GitHub again. If this keeps happening, please ${CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT}.`;
export const AUTH_CODE_NO_SESSION_MESSAGE = `Sign in did not complete. Please try signing in with GitHub again. If this keeps happening, please ${CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT}.`;

export function isBannedAccountAuthError(message: string | null | undefined) {
  const lowered = message?.trim().toLowerCase();
  if (!lowered) return false;
  return (
    lowered.includes("account banned") ||
    lowered.includes("account has been banned") ||
    lowered.includes("account is banned") ||
    lowered.includes("not in good standing and cannot sign in") ||
    lowered.includes("account disabled") ||
    lowered.includes("account has been disabled") ||
    lowered.includes("account is disabled")
  );
}

export function routeToBannedAccountPage() {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", BANNED_ACCOUNT_PATH);
  window.dispatchEvent(
    typeof PopStateEvent === "function" ? new PopStateEvent("popstate") : new Event("popstate"),
  );
}

export function normalizeAuthErrorMessage(message: string | null | undefined, fallback: string) {
  const normalized = message?.trim();
  if (!normalized) return fallback;

  const lowered = normalized.toLowerCase();
  if (lowered === "access_denied") return ACCESS_DENIED_SIGN_IN_MESSAGE;
  if (lowered.includes("permanently deleted")) return DELETED_SIGN_IN_MESSAGE;
  if (lowered.includes("cannot be restored") && lowered.includes("deleted")) {
    return DELETED_SIGN_IN_MESSAGE;
  }
  if (isBannedAccountAuthError(lowered)) {
    return BANNED_SIGN_IN_MESSAGE;
  }

  return normalized;
}

export function getUserFacingAuthError(error: unknown, fallback: string) {
  return normalizeAuthErrorMessage(getUserFacingConvexError(error, fallback), fallback);
}
