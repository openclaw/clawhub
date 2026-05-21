/**
 * Skill icon storage format: a `kind:value` protocol string.
 *
 * Phase 1 only ships the `lucide:<IconName>` source. Future phases that add
 * external URLs or Convex Storage uploads can reuse the same field without a
 * schema change.
 *
 * The server performs only minimal format validation and does not maintain
 * the concrete lucide allow-list — `src/lib/skillIcon.ts` on the client owns
 * the render whitelist. When the client cannot resolve an icon it falls back
 * to the default kind icon, so we accept any well-formed identifier here to
 * avoid coupling backend deploys to client-side constants.
 */

const MAX_ICON_VALUE_LENGTH = 64;
const LUCIDE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Parse and sanitize the icon string supplied at publish time.
 * - Non-string or blank input: returns `undefined` (treated as unset).
 * - Unknown protocol or malformed value: returns `undefined` (same as unset).
 * - Valid `lucide:<Name>`: returns a normalized string with a lower-cased
 *   protocol prefix and the original-case icon name preserved.
 */
export function normalizeSkillIconValue(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_ICON_VALUE_LENGTH) return undefined;

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex <= 0) return undefined;

  const kind = trimmed.slice(0, colonIndex).toLowerCase();
  const value = trimmed.slice(colonIndex + 1);
  if (!value) return undefined;

  if (kind === "lucide") {
    return LUCIDE_NAME_PATTERN.test(value) ? `lucide:${value}` : undefined;
  }

  // Phase 1 does not expose other protocols; extend here when adding
  // url / storage support.
  return undefined;
}
