/**
 * Emergency switch that stops every HTTP quota read and write
 * (`CLAWHUB_RATE_LIMITER_DISABLED=1`). Nothing touches the rate-limiter tables
 * while it is set, so they can be cleared or dropped and recreated safely.
 * Identity verification and the verified-edge requirement still apply.
 */
export function isRateLimiterStorageDisabled(): boolean {
  return process.env.CLAWHUB_RATE_LIMITER_DISABLED?.trim() === "1";
}
