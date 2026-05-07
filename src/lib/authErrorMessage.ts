import { getUserFacingConvexError } from "./convexError";

export const BANNED_SIGN_IN_MESSAGE =
  "This ClawHub account is not in good standing and cannot sign in. If you believe this is a mistake, please contact security@openclaw.ai and we will review it.";
export const DELETED_SIGN_IN_MESSAGE =
  "This ClawHub account was permanently deleted and cannot sign in again.";
export const ACCESS_DENIED_SIGN_IN_MESSAGE =
  "Sign in was denied. If this ClawHub account was disabled or banned in error, please contact security@openclaw.ai.";
export const AUTH_CODE_NO_SESSION_MESSAGE =
  "Sign in did not create a session. If this ClawHub account was deleted, banned, or disabled, it cannot sign in. Please contact security@openclaw.ai if you believe this is a mistake.";

export function normalizeAuthErrorMessage(message: string | null | undefined, fallback: string) {
  const normalized = message?.trim();
  if (!normalized) return fallback;

  const lowered = normalized.toLowerCase();
  if (lowered === "access_denied") return ACCESS_DENIED_SIGN_IN_MESSAGE;
  if (lowered.includes("permanently deleted")) return DELETED_SIGN_IN_MESSAGE;
  if (lowered.includes("cannot be restored") && lowered.includes("deleted")) {
    return DELETED_SIGN_IN_MESSAGE;
  }
  if (
    lowered.includes("account banned") ||
    lowered.includes("account has been banned") ||
    lowered.includes("account is banned") ||
    lowered.includes("not in good standing") ||
    lowered.includes("account disabled") ||
    lowered.includes("account has been disabled") ||
    lowered.includes("account is disabled")
  ) {
    return BANNED_SIGN_IN_MESSAGE;
  }

  return normalized;
}

export function getUserFacingAuthError(error: unknown, fallback: string) {
  return normalizeAuthErrorMessage(getUserFacingConvexError(error, fallback), fallback);
}
