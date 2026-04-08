import { getUserFacingConvexError } from "./convexError";

export const BANNED_SIGN_IN_MESSAGE =
  "This account has been banned and cannot sign in. If you believe this is a mistake, please contact security@openclaw.ai and we will review it.";
export const DELETED_SIGN_IN_MESSAGE =
  "This account has been permanently deleted and cannot sign in.";
export const ACCESS_DENIED_SIGN_IN_MESSAGE =
  "Sign in was denied. If this account was disabled or banned in error, please contact security@openclaw.ai.";

export function normalizeAuthErrorMessage(message: string | null | undefined, fallback: string) {
  const normalized = message?.trim();
  if (!normalized) return fallback;

  const lowered = normalized.toLowerCase();
  if (lowered === "access_denied") return ACCESS_DENIED_SIGN_IN_MESSAGE;
  if (lowered.includes("permanently deleted")) return DELETED_SIGN_IN_MESSAGE;
  if (lowered.includes("cannot be restored") && lowered.includes("deleted")) {
    return DELETED_SIGN_IN_MESSAGE;
  }
  if (lowered.includes("account banned")) return BANNED_SIGN_IN_MESSAGE;

  return normalized;
}

export function getUserFacingAuthError(error: unknown, fallback: string) {
  return normalizeAuthErrorMessage(getUserFacingConvexError(error, fallback), fallback);
}
