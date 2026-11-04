import { ConvexError } from "convex/values";

export function isConvexWritePressureError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    /\bCommitterFullError: Too many writes in a short period of time\./.test(error.message)
  );
}

// Platform failures Convex reports for a request it could not run, as opposed
// to an application `ConvexError` or validation `Error`. Each signature is a
// captured Convex system-error shape (code prefix or fixed platform text), so
// user-supplied strings embedded in validation messages cannot match by
// accident. Retrying these usually succeeds; they must never surface as 4xx.
const CONVEX_TRANSIENT_SYSTEM_ERROR_PATTERNS = [
  /\bInternalServerError: /,
  /\bOverloaded(?:Error)?: /,
  /\bTransient error while /,
  /Your request couldn't be completed\. Try again later\./,
] as const;

const CONVEX_WRITE_CONFLICT_PATTERN =
  /Documents? (?:read from or written to|in) (?:the )?(?:table )?"[^"]+"(?: table)? changed while this mutation was being run/;

export type TransientConvexErrorKind = "write_conflict" | "system";

export function getTransientConvexErrorKind(error: unknown): TransientConvexErrorKind | null {
  // `ConvexError` is how application code reports expected failures; it keeps
  // its own status mapping even if its text quotes a platform message.
  if (!(error instanceof Error)) return null;
  const message = error.message;
  if (error instanceof ConvexError) return null;
  if (isConvexWritePressureError(error)) return "system";
  if (CONVEX_TRANSIENT_SYSTEM_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return "system";
  }
  const lower = message.toLowerCase();
  if (
    lower.includes("optimistic concurrency") ||
    lower.includes("write conflict") ||
    CONVEX_WRITE_CONFLICT_PATTERN.test(message)
  ) {
    return "write_conflict";
  }
  return null;
}

export function parseBooleanQueryParam(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function parseBooleanQueryParamOptional(value: string | null) {
  if (value == null) return undefined;
  return parseBooleanQueryParam(value);
}

export function resolveBooleanQueryParam(primaryValue: string | null, legacyValue: string | null) {
  return (
    parseBooleanQueryParamOptional(primaryValue) ?? parseBooleanQueryParamOptional(legacyValue)
  );
}
