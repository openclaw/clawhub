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

export function getUserFacingConvexError(error: unknown, fallback: string) {
  const candidates: string[] = [];
  const maybe = error as ConvexLikeError;

  if (maybe && typeof maybe === "object" && "data" in maybe) {
    if (typeof maybe.data === "string") candidates.push(maybe.data);
    if (maybe.data && typeof maybe.data === "object" && typeof maybe.data.message === "string") {
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
    return cleaned;
  }

  return fallback;
}
