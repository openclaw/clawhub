import { hasOwnProperty } from "./hasOwnProperty";

type ConvexLikeErrorData =
  | string
  | {
      message?: unknown;
    }
  | null
  | undefined;

type ConvexLikeError = {
  data?: ConvexLikeErrorData;
  message?: unknown;
};

function cleanupConvexMessage(message: string) {
  return message
    .replace(/\[CONVEX[^\]]*\]\s*/g, "")
    .replace(/\[Request ID:[^\]]*\]\s*/g, "")
    .replace(/^Server Error Called by client\s*/i, "")
    .replace(/^ConvexError:\s*/i, "")
    .trim();
}

function normalizeGenericDenialMessage(message: string) {
  if (/^unauthorized$/i.test(message)) {
    return "Sign in required. If this ClawHub account was deleted, banned, or disabled, it cannot perform this action.";
  }
  if (/^forbidden$/i.test(message)) {
    return "This ClawHub account does not have permission to perform this action, or the account is not in good standing.";
  }
  return message;
}

export function getUserFacingConvexError(error: unknown, fallback: string) {
  const candidates: string[] = [];
  const maybe = error as ConvexLikeError;

  if (hasOwnProperty(maybe, "data")) {
    if (typeof maybe.data === "string") candidates.push(maybe.data);
    if (hasOwnProperty(maybe.data, "message") && typeof maybe.data.message === "string") {
      candidates.push(maybe.data.message);
    }
  }

  if (error instanceof Error && typeof error.message === "string") {
    candidates.push(error.message);
  } else if (maybe && typeof maybe.message === "string") {
    candidates.push(maybe.message);
  }

  for (const raw of candidates) {
    const cleaned = cleanupConvexMessage(raw);
    if (!cleaned) continue;
    if (/^server error$/i.test(cleaned)) continue;
    if (/^internal server error$/i.test(cleaned)) continue;
    return normalizeGenericDenialMessage(cleaned);
  }

  return fallback;
}
