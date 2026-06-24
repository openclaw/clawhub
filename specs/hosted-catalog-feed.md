---
summary: "ClawHub publication contract for the OpenClaw hosted plugin catalog feed."
read_when:
  - Publishing the OpenClaw hosted plugin catalog feed
  - Changing feed entries, cache headers, or publication workflow
  - Wiring registry.openclaw.ai to ClawHub
---

# Hosted Catalog Feed

ClawHub is the canonical producer for the initial OpenClaw plugin and skill
feeds. The feeds are projections of the existing public package, release, and
skill records; they are not second catalogs.

## Contract

- Feed id: `clawhub-official`
- Schema version: `2`
- Initial scope: `code-plugin` and `bundle-plugin` packages plus official skills
- Source profiles: `public-clawhub` for ClawHub-hosted artifacts and
  `public-github` for source-backed skills available through the public feed
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

The skills feed uses the same envelope and `/v1/feeds/skills` route. It emits
`type: "skill"` entries with `@<publisher>/<slug>` ids and ClawHub install
coordinates. It includes only skills with an active latest published version,
non-empty files, a SHA-256 integrity hash, and an active official publisher
record. Both verified organization and personal publishers are included;
unverified publishers are excluded.

GitHub-backed skills are emitted only when the current upstream content is
available through the public feed gate: `installKind: "github"`,
`githubCurrentStatus: "present"`, `githubScanStatus: "clean"` or
`"suspicious"`, no upstream removal marker, complete repo/path/commit/content
hash fields, and a live GitHub source row owned by the same official publisher.
These entries use a `public-github` candidate with the commit as `version`,
`sha256:<githubCurrentContentHash>` as integrity, and an additive `github`
object containing immutable `repo`, `path`, `commit`, and `contentHash`.
Suspicious GitHub-backed entries follow the same public feed visibility pattern
as suspicious hosted packages and skills.
Pending, failed, malicious, missing, removed, hidden, soft-deleted, or
incomplete GitHub-backed skills are not emitted.

## Publication

`convex/catalogFeed.ts` builds both feeds from indexed package/skill queries and
stores one current publication row per feed in `catalogFeedPublications`.
Keeping one row per feed avoids an unbounded publication log while preserving
the sequence and exact payload needed for validators.

The `Publish Hosted Catalog Feed` workflow refreshes the snapshot every six
hours and can be run manually. It requires the existing `Production` environment
`CONVEX_DEPLOY_KEY`. The workflow currently publishes an unsigned feed; signed
envelopes require a separate production key-management decision and must not be
advertised to OpenClaw clients until the signing key and trust root are deployed.

## Edge delivery

The HTTP endpoints are `/api/v1/feeds/plugins` and `/api/v1/feeds/skills`. Each
returns its stored bytes unchanged and provides:

- `ETag: "sha256:<payload hash>"`
- `Last-Modified`
- `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400`
- `Surrogate-Control: max-age=300, stale-while-revalidate=86400`
- `304 Not Modified` for matching `If-None-Match` or `If-Modified-Since`

`vercel.json` exposes both `/v1/feeds/plugins` and `/v1/feeds/skills` as
edge-friendly rewrites to the Convex endpoints. The unversioned `/feeds/*`
paths permanently redirect to their versioned paths. The
`registry.openclaw.ai` custom domain must point at the same Vercel project
before the public RFC URLs are enabled.

The serialized payload uses stable object-key ordering and deterministic entry
and install-candidate ordering. Additive fields may be introduced within a
major version; incompatible wire changes require a new versioned route and
schema version.

`/.well-known/openclaw-registry.json` advertises both versioned feeds.
`/.well-known/clawhub.json` remains the ClawHub API discovery document.

Do not make the feed request-time dynamic. Refresh the stored publication first,
then let Vercel or the configured CDN cache the immutable response by ETag.
