---
summary: "ClawHub publication contract for the OpenClaw hosted plugin catalog feed."
read_when:
  - Publishing the OpenClaw hosted plugin catalog feed
  - Changing feed entries, cache headers, or publication workflow
  - Wiring registry.openclaw.ai to ClawHub
---

# Hosted Catalog Feed

ClawHub is the canonical producer for the initial OpenClaw plugin feed. The
feed is a projection of the existing public package and release records; it is
not a second package catalog.

## Contract

- Feed id: `clawhub-official`
- Schema version: `1`
- Initial scope: `code-plugin` and `bundle-plugin` packages only
- Source profile: `public-clawhub`
- Entry identity: normalized ClawHub package name
- Install coordinate: package name plus exact release version
- Integrity: `sha256:<artifact sha256>`
- Publisher trust: `official`, derived from ClawHub's official publisher state
- Initial entry state: `available`
- Required feed metadata: `generatedAt`, monotonic `sequence`, and `expiresAt`

The producer excludes soft-deleted packages, inactive releases, releases without
an artifact digest, and releases blocked by ClawHub security or moderation
state. The feed contains no registry URLs, credentials, source tokens, or
bootstrap trust keys.

The feed intentionally emits RFC 19's canonical entry shape rather than
OpenClaw's current legacy bundled-catalog entries. The staged OpenClaw hosted
feeds stack must add its RFC-entry adapter before `registry.openclaw.ai` is
enabled as the default client feed; publishing this snapshot is otherwise
safe, but pre-adapter clients will fall back to their bundled catalog.

## Publication

`convex/catalogFeed.ts` builds the feed from indexed package queries and stores
one current publication row in `catalogFeedPublications`. Keeping one row avoids
an unbounded publication log while preserving the sequence and exact payload
needed for validators.

The `Publish Hosted Catalog Feed` workflow refreshes the snapshot every six
hours and can be run manually. It requires the existing `Production` environment
`CONVEX_DEPLOY_KEY`. The workflow currently publishes an unsigned feed; signed
envelopes require a separate production key-management decision and must not be
advertised to OpenClaw clients until the signing key and trust root are deployed.

## Edge delivery

The HTTP endpoint is `/api/v1/feeds/plugins`. It returns the stored bytes
unchanged and provides:

- `ETag: "sha256:<payload hash>"`
- `Last-Modified`
- `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400`
- `Surrogate-Control: max-age=300, stale-while-revalidate=86400`
- `304 Not Modified` for matching `If-None-Match`

`vercel.json` exposes `/feeds/plugins` as an edge-friendly rewrite to the
Convex endpoint. The `registry.openclaw.ai` custom domain must point at the
same Vercel project before the public RFC URL is enabled.

Do not make the feed request-time dynamic. Refresh the stored publication first,
then let Vercel or the configured CDN cache the immutable response by ETag.
