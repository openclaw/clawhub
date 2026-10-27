# Data-only Themes registry

Themes are a separate registry, not executable packages or skills. Only the
explicit /api/v1/themes namespace lists, searches, publishes, or reads them.
OpenClaw's Appearance settings is the intended discovery/install surface.

## Trust and persistence

- The themes table owns publisher/name identity and latest semver metadata;
  themeVersions owns immutable normalized definitions and SHA-256. Both are
  permanent registry records, classified by the existing retention policy.
- No writes to packages, skills, their digests, homepage/trending/featured
  projections, install counts, feeds, or exports. General discoverability is
  prevented by storage ownership, not a caller-provided category filter.
- API-token authentication is reused. The publication transaction rereads the
  current token/account and resolves the publisher through the existing
  publisher ownership/membership owner. It accepts no caller-selected user ID.
- Exact versions are immutable. Retrying identical content is idempotent;
  reusing a version for different content conflicts. An older semver release
  never downgrades latest. Publisher renames resolve through publisher identity.
- Public reads omit unlisted themes, withdrawn versions, inactive publishers,
  and inactive/deleted linked accounts. Withdrawal flags are internal state;
  this first version does not add a public moderation or deletion workflow.

## Portable contract

packages/schema/src/themes.ts adapts the MIT-licensed OpenClaw normalizer from
packages/gateway-protocol/src/theme.ts at
929abf856df06ab6daaa086a1496ef6c194e32c3. Its default normalization order,
color/font grammar, built-in branding choices, text bounds and UTF-8 size limit
must remain synchronized with OpenClaw. The accompanying contract tests cover
accepted CSS color values, local font-family names, rejected executable CSS,
unknown fields, palettes, branding, and normalized limits. This is not a CSS
stylesheet API. No external assets, URLs, HTML, SVG, JavaScript, dependencies,
npm packages or tarballs are admitted as theme fields.

A definition requires name (80 characters), description (320 characters), and
at least one complete light/dark semantic palette. Normalized JSON is at most
4096 UTF-8 bytes. SHA-256 covers UTF-8 JSON.stringify(normalizedDefinition),
including the normalizer's stable property order; it is not a hash of submitted
whitespace or property ordering. The HTTP envelope is capped at 16384 bytes.

## Query behavior

Browse uses the listed/updatedAt index; search uses the dedicated searchText
index. Native cursor pagination is bounded (default 24, maximum 100). Filtering
inactive publishers or withdrawn latest versions can produce a short/empty
page with a non-null next cursor; clients must continue using that cursor.
Search matches theme names, slugs, and descriptions; exact publisher-handle
queries resolve through the authoritative publisher and owner index, so renames
do not leave stale owner search terms. Searching never scans the general
package or skill registry. No deployment or
backfill is performed by this change; the new empty tables/indexes need the
normal Convex deployment before these endpoints become live.
