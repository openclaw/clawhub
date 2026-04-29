import { ConvexError } from "convex/values";

// Slug shape rules:
// - Lowercase letters, digits, and single hyphens only.
// - Must start and end with a letter or digit.
// - No consecutive hyphens ("--", "---", ...).
// - Length 3..48 (URL/SEO friendly, aligned with publisher handle).
//
// The pattern enforces first/last char class and forbids consecutive hyphens
// via a negative lookahead. Length bounds are checked separately so we can
// emit precise error messages.
const SLUG_PATTERN = /^[a-z0-9](?:(?!--)[a-z0-9-])*[a-z0-9]$/;

const MIN_SLUG_LENGTH = 3;
const MAX_SLUG_LENGTH = 48;

// Reserved slugs. These are blocked because they would:
// 1. Clash semantically with top-level routes under src/routes/*.
// 2. Allow brand/role impersonation (e.g. "official", "clawhub").
// 3. Lock future route expansion (e.g. "api", "auth", "oauth").
//
// Keep this list in sync with:
//   - src/routes/*.tsx top-level segments
//   - brand names shipped in README.md
const RESERVED_SKILL_SLUGS: ReadonlySet<string> = new Set([
  // Current top-level route segments under src/routes/.
  "about",
  "admin",
  "cli",
  "dashboard",
  "import",
  "management",
  "orgs",
  "packages",
  "plugins",
  "publish",
  "publish-plugin",
  "publish-skill",
  "search",
  "settings",
  "skills",
  "souls",
  "stars",
  "u",
  "upload",
  "users",
  // Reserved for likely future additions.
  "api",
  "auth",
  "oauth",
  "callback",
  "login",
  "logout",
  "signin",
  "signout",
  "signup",
  "register",
  "docs",
  "doc",
  "help",
  "support",
  "status",
  "health",
  "blog",
  "news",
  "pricing",
  "terms",
  "privacy",
  "legal",
  "contact",
  "home",
  "explore",
  // Brand and project names.
  "openclaw",
  "clawhub",
  "clawd",
  "clawdbot",
  "onlycrabs",
  "soulhub",
  // Generic identity / role words.
  "me",
  "self",
  "system",
  "root",
  "owner",
  "official",
  "staff",
  "team",
  "mod",
  "moderator",
  // Reserved CRUD/action words that would make URLs ambiguous.
  "new",
  "edit",
  "delete",
  "create",
  "update",
  "remove",
  "public",
  "private",
  "internal",
  // Literals that would be confusing in URLs.
  "null",
  "undefined",
  "true",
  "false",
]);

export interface ValidateSlugOptions {
  /**
   * Bypass the reserved-word blocklist.
   * Intended for admin migrations / internal seeding only.
   */
  allowReserved?: boolean;
}

export const SKILL_SLUG_CONSTRAINTS = {
  minLength: MIN_SLUG_LENGTH,
  maxLength: MAX_SLUG_LENGTH,
  pattern: SLUG_PATTERN,
  reserved: RESERVED_SKILL_SLUGS,
} as const;

/**
 * Lowercase and trim a slug. Does not throw.
 *
 * Safe to call on any read-path input (query by slug, redirect lookup, ...)
 * without rejecting legacy data.
 */
export function normalizeSkillSlug(raw: string | undefined | null): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Variant that returns null when the input normalizes to an empty string.
 * Useful at read-path call sites that want to short-circuit lookup.
 */
export function normalizeSkillSlugOrNull(raw: string | undefined | null): string | null {
  const normalized = normalizeSkillSlug(raw);
  return normalized.length ? normalized : null;
}

/**
 * Check whether a string already matches the full slug shape rules.
 * Returns true only when the value is a plausible slug (length, pattern).
 *
 * Used by search to decide whether to attempt an exact-slug lookup.
 * Note: this intentionally does NOT consult the reserved-word blocklist
 * because legacy rows may still carry reserved slugs and we want to
 * keep them readable.
 */
export function isValidSkillSlugShape(value: string | undefined | null): boolean {
  const normalized = normalizeSkillSlug(value);
  if (normalized.length < MIN_SLUG_LENGTH || normalized.length > MAX_SLUG_LENGTH) {
    return false;
  }
  return SLUG_PATTERN.test(normalized);
}

/**
 * Returns a normalized slug or throws ConvexError describing the first
 * violation encountered. Use this on every write path (publish/rename).
 */
export function assertValidSkillSlug(
  rawSlug: string | undefined | null,
  options: ValidateSlugOptions = {},
): string {
  const normalized = normalizeSkillSlug(rawSlug);

  if (!normalized) {
    throw new ConvexError("Slug is required.");
  }
  if (normalized.length < MIN_SLUG_LENGTH) {
    throw new ConvexError(`Slug must be at least ${MIN_SLUG_LENGTH} characters.`);
  }
  if (normalized.length > MAX_SLUG_LENGTH) {
    throw new ConvexError(`Slug must be at most ${MAX_SLUG_LENGTH} characters.`);
  }
  if (!SLUG_PATTERN.test(normalized)) {
    throw new ConvexError(
      "Slug must start and end with a letter or digit, contain only lowercase letters, " +
        "digits, and single hyphens, and not contain consecutive hyphens.",
    );
  }
  if (!options.allowReserved && RESERVED_SKILL_SLUGS.has(normalized)) {
    throw new ConvexError(`"${normalized}" is reserved and cannot be used as a slug.`);
  }
  return normalized;
}

/**
 * Convenience predicate: is the slug on the reserved blocklist?
 * Exposed so callers (e.g. admin tooling) can pre-check without a throw.
 */
export function isReservedSkillSlug(slug: string | undefined | null): boolean {
  const normalized = normalizeSkillSlug(slug);
  return RESERVED_SKILL_SLUGS.has(normalized);
}
