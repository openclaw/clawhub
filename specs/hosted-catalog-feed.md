---
summary: "ClawHub publication contract for the OpenClaw hosted plugin, skill, and promotions feeds."
read_when:
  - Publishing an OpenClaw hosted feed
  - Changing feed entries, cache headers, or publication workflow
  - Wiring registry.openclaw.ai to ClawHub
---

# Hosted Feeds

ClawHub is the canonical producer for the initial OpenClaw plugin and skill
feeds and the runtime promotions feed. The feeds are projections of existing
public package, release, skill, and promotion records; they are not second
catalogs.

## Contract

- Feed id: `clawhub-official`
- Schema version: `1`
- Initial scope: `code-plugin` and `bundle-plugin` packages plus official skills
- Source profiles: `public-clawhub` for ClawHub-hosted artifacts and
  `public-github` for source-backed skills available through the public feed
- Entry identity: normalized ClawHub package name
- Install coordinate: package name plus exact release version
- Integrity: `sha256:<artifact sha256>`
- Publisher trust: `official`, derived from ClawHub's official publisher state
- Initial entry state: `available`
- Required feed metadata: `generatedAt`, monotonic `sequence`, and `expiresAt`

`schemaVersion` is a cross-repo wire contract with the OpenClaw hosted feed
consumer. Do not bump it until matching OpenClaw parser and validation support
has shipped, or current clients will reject the hosted feed and fall back to
bundled data.
Any pull request changing `CATALOG_FEED_SCHEMA_VERSION` must carry the
`schema-version-approved` label, added only after explicit approval confirms
that the matching OpenClaw parser and validation work is coordinated. A new
commit that changes the schema version automatically removes the label so the
current revision must be approved again.

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
Until the skills feed has pagination or sharding, it publishes at most 1000
eligible entries per snapshot so a large skills corpus does not block the plugin
feed publication path.

The promotions feed uses id `clawhub-promotions`, schema version `1`, and the
`/v1/feeds/promotions` route. Entries are declarative promotion records, not
commands or executable content. They may identify providers, auth choices,
plugins, models, and HTTPS signup/docs/launch URLs. Only promotions with
`status: "active"` whose launch window has started are published. The active
set is capped at 50 records by the promotions write path, which also bounds each
snapshot. Public slug lookups keep ended promotions readable only when they
actually crossed their launch boundary; promotions canceled before launch stay
private permanently, even if their scheduled window or other fields are edited.
Expired drafts cannot be activated, and unlaunched active promotions cannot be
rescheduled wholly into an expired window. Model references and aliases are
single-line fields so management form serialization remains lossless.

The write path also enforces the OpenClaw consumer's authoring grammars so a
promotion can never publish in a shape clients reject or silently degrade on:
model refs, provider, and auth choice id are restricted to shell-safe
identifier characters because the CLI echoes them into copy-paste commands
and refuses anything else; aliases must be typed identifiers (letters,
digits, `._:-`, no spaces) because the CLI skips aliases it cannot register;
plugin names use the package registry's canonical npm-safe grammar (scoped
`@scope/name` allowed); and when a provider is declared, every model ref must
start with `<provider>/`, matching the CLI's refusal to configure models
outside the promotion's declared provider.

## Publication

`convex/catalogFeed.ts` builds both feeds from indexed package/skill queries and
stores one current publication row per feed in `catalogFeedPublications`.
Keeping one row per feed avoids an unbounded publication log while preserving
the sequence and exact payload needed for validators.

The `Publish Hosted Catalog Feed` workflow refreshes the snapshot every six
hours and can be run manually. It requires the existing `Production` environment
`CONVEX_DEPLOY_KEY`. Publication stores the canonical unsigned payload bytes;
the plugin HTTP action wraps those exact bytes in a deterministic DSSE/Ed25519
envelope. The private key stays in Convex environment secret storage and the
matching public key is bundled in OpenClaw.

The response uses the standard DSSE JSON envelope fields: `payloadType`,
`payload`, and `signatures` containing `keyid` and `sig`. Ed25519 is selected by
the trusted key profile rather than repeated as a nonstandard signature field.
The signed representation uses the `application/vnd.dsse+json` media type.

`convex/promotionsFeed.ts` builds the promotions snapshot from the bounded active
set and stores it in the same publication table. Production backend deploys
publish an initial snapshot before contract verification. Promotion updates and
status changes schedule an immediate refresh. Active promotions also schedule
refreshes at `startsAt` and at `endsAt + 1ms`: both window endpoints are
inclusive, so the expiry refresh must run after the final active millisecond. A
six-hour cron is the backstop for long-running or empty feeds, keeping every
snapshot inside its 24-hour `expiresAt` horizon.

## Edge delivery

The HTTP endpoints are `/api/v1/feeds/plugins`, `/api/v1/feeds/skills`, and
`/api/v1/feeds/promotions`. Each representation provides:

- `ETag: "sha256:<payload hash>"`
- `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400`
- `Surrogate-Control: max-age=300, stale-while-revalidate=86400`
- `304 Not Modified` for matching `If-None-Match`

Unsigned skills and promotions also expose `Last-Modified` and accept
`If-Modified-Since`. The signed plugin representation intentionally does not:
rotating its signer changes the envelope without changing the underlying
publication time, so only its representation ETag is a valid cache validator.

The plugin feed route requires one atomic `CLAWHUB_FEED_SIGNING_CONFIG` JSON
secret containing exactly `keyId` and `privateKey`. It returns `503` with
`Cache-Control: no-store` when the value is absent or invalid. Its ETag and
`X-Content-SHA256` describe the signed envelope representation;
`X-Catalog-Payload-SHA256` preserves the stored publication payload digest.
Skills and promotions remain on their existing unsigned representations until
their payload types and matching OpenClaw consumers are specified.

Nitro exposes `/v1/feeds/plugins`, `/v1/feeds/skills`, and
`/v1/feeds/promotions` through the same environment-aware Convex proxy used for
`/api/*`. The unversioned `/feeds/*` paths permanently redirect to their
versioned paths. The `registry.openclaw.ai` custom domain must point at the same
Vercel project before the public RFC URLs are enabled.

The serialized payload uses stable object-key ordering and deterministic entry
and install-candidate ordering. Additive fields may be introduced within a
major version; incompatible wire changes require a new versioned route and
schema version.

`/.well-known/openclaw-registry.json` advertises the plugin and skill feeds.
`/.well-known/clawhub.json` remains the ClawHub API discovery document.

Do not make the feed request-time dynamic. Refresh the stored publication first,
then let Vercel or the configured CDN cache the immutable response by ETag.

## Feed signing runbook

ClawHub owns the private key and stable key id. OpenClaw owns distribution of
the matching public trust anchor. Do not reuse release, package, TLS, account,
or other platform signing keys for feed signing, and do not publish a trust
bootstrap endpoint from the same origin as the feed.

### Initial provisioning

1. Generate a dedicated Ed25519 key pair on an approved operator machine:

   ```bash
   openssl genpkey -algorithm ED25519 -out clawhub-feed-private.pem
   openssl pkey -in clawhub-feed-private.pem -pubout -out clawhub-feed-public.pem
   ```

2. Choose a stable, non-secret key id such as `clawhub-feed-2026-q3`. Record the
   owner, creation time, intended deployment, and rotation contact in the
   operator secret inventory.
3. Store the key id and private PEM as one atomic JSON value in each intended
   Convex deployment. Do not create separate mutable variables for the pair: a
   partially rotated pair can publish an unverifiable cacheable envelope. For
   production, use the Convex dashboard or pipe compact JSON to the CLI without
   placing the private key in shell history:

   ```powershell
   @{
     keyId = "clawhub-feed-2026-q3"
     privateKey = Get-Content -Raw .\clawhub-feed-private.pem
   } | ConvertTo-Json -Compress |
     bunx convex env set CLAWHUB_FEED_SIGNING_CONFIG --prod
   ```

4. Confirm only the variable names, not their values:

   ```bash
   bunx convex env list --names-only --prod
   ```

5. Provide `clawhub-feed-public.pem` and the key id to the OpenClaw maintainer
   bundling the `clawhub-public` trust profile. The private PEM never leaves
   ClawHub's operator-controlled secret path.
6. Deploy ClawHub, publish a fresh `clawhub-official` snapshot, and verify that
   `/api/v1/feeds/plugins` returns an envelope whose decoded payload bytes equal
   the stored publication and whose signature verifies with the handed-off
   public key.
7. Land and release the matching OpenClaw bundled public key. Older unsigned
   clients may fall back to their bundled catalog when they first encounter the
   envelope; they must not reinterpret it as unsigned feed content.
8. Securely delete operator-machine private-key files after the approved secret
   backup and recovery process is complete.

### Normal rotation

1. Generate a new dedicated key and key id.
2. Bundle the new public key in OpenClaw while the old key remains trusted.
3. After that trust update is available, replace
   `CLAWHUB_FEED_SIGNING_CONFIG` once with JSON containing the new matched pair,
   then deploy. Never stage key id and private key separately.
4. Verify a higher-sequence publication under the new key before retiring the
   old private key.
5. Remove the old public key in a later OpenClaw release after the supported
   client overlap window.

The first signer emits one signature, so it cannot provide an old-and-new
dual-sign overlap by itself. If operational policy requires dual signing, add
multi-key signer support before beginning that rotation.

### Emergency revocation

Remove `CLAWHUB_FEED_SIGNING_CONFIG` or replace it with a new matched pair in
Convex immediately. An absent signing configuration makes the plugin feed return
`503 no-store`. Notify OpenClaw maintainers to remove the compromised public key
through the authenticated release channel. Do not recover by advertising a new
public key from a feed-adjacent endpoint.
