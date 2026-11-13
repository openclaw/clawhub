import type { RateLimitArgs, RateLimitReturns } from "@convex-dev/rate-limiter";

export function isRateLimitArgs(args: unknown): args is RateLimitArgs {
  if (!args || typeof args !== "object") return false;
  const value = args as Record<string, unknown>;
  const config = value.config as Record<string, unknown> | undefined;
  return (
    typeof value.name === "string" &&
    (!("key" in value) || typeof value.key === "string") &&
    !!config &&
    typeof config === "object" &&
    (config.kind === "fixed window" || config.kind === "token bucket") &&
    typeof config.rate === "number" &&
    typeof config.period === "number"
  );
}

export const okRate = (): RateLimitReturns => ({
  ok: true,
});
