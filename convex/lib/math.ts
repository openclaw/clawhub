/**
 * Clamp a numeric value to an integer within [min, max].
 *
 * Truncates toward zero (like `Math.trunc`), handles NaN / ±Infinity by
 * falling back to `min`, and clamps the result to the given range.
 */
export function clampInt(value: number, min: number, max: number): number {
  const truncated = Math.trunc(value);
  if (!Number.isFinite(truncated)) return min;
  return Math.min(max, Math.max(min, truncated));
}
