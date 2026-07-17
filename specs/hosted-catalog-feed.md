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
The skills feed has no legacy 1000-entry publication cap. Complete snapshots are
published as immutable digest-addressed shards behind a signed root. While a
snapshot still fits the legacy atomic representation, both forms are published
at the same sequence; once it exceeds the atomic limit, `/v1/feeds/skills`
redirects to `/v1/feeds/skills/root` instead of returning a silently truncated
catalog.

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
It also keeps a bounded 30-day revision and change journal. Each revision stores
its own change count and the cumulative retained count, allowing a reader to pin
an exact sequence range and page it without scanning or counting the journal.
Retention removes a revision marker before its change rows so a concurrent
reader receives a reset response instead of a partial revision.

The `Publish Hosted Catalog Feed` workflow refreshes the snapshot every six
hours and can be run manually. It requires the existing `Production` environment
`CONVEX_DEPLOY_KEY`. Publication stores the canonical unsigned payload bytes;
the plugin HTTP action wraps those exact bytes in a deterministic DSSE/Ed25519
envelope. The private key stays in Convex environment secret storage and the
matching public key is bundled in OpenClaw.

The response uses the standard DSSE JSON envelope fields: `payloadType`,
`payload`, and `signatures` containing `keyid` and `sig`. Ed25519 is selected by
the trusted key profile rather than repeated as a nonstandard signature field.
The signed representation uses the `application/vnd.dsse+json` media type and
is selected only when the client sends that media type in `Accept`. Requests
without that opt-in retain the existing unsigned JSON representation.

`convex/promotionsFeed.ts` builds the promotions snapshot from the bounded active
set and stores it in the same publication table. Production backend deploys
publish an initial snapshot before contract verification. Promotion updates and
status changes schedule an immediate refresh. Active promotions also schedule
refreshes at `startsAt` and at `endsAt + 1ms`: both window endpoints are
inclusive, so the expiry refresh must run after the final active millisecond. A
six-hour cron is the backstop for long-running or empty feeds, keeping every
snapshot inside its 24-hour `expiresAt` horizon.

## Edge delivery

The snapshot endpoints are `/api/v1/feeds/plugins`, `/api/v1/feeds/skills`, and
`/api/v1/feeds/promotions`. Each snapshot representation provides:

- `ETag: "sha256:<payload hash>"`
- `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400`
- `Surrogate-Control: max-age=300, stale-while-revalidate=86400`
- `304 Not Modified` for matching `If-None-Match`

Unsigned skills and promotions also expose `Last-Modified` and accept
`If-Modified-Since`. The signed plugin representation intentionally does not:
rotating its signer changes the envelope without changing the underlying
publication time, so only its representation ETag is a valid cache validator.

The signed plugin representation requires one atomic
`CLAWHUB_FEED_SIGNING_CONFIG` JSON secret containing exactly `keyId` and
`privateKey`. An opted-in signed request returns `503` with `Cache-Control:
no-store` when the value is absent or invalid; unsigned requests remain
available during rollout and signer incidents. Responses include `Vary:
Accept`. The signed representation's ETag and
`X-Content-SHA256` describe the signed envelope representation;
`X-Catalog-Payload-SHA256` preserves the stored publication payload digest.
The legacy atomic skills and promotions representations remain unsigned. The
skills shard root has its own signed payload type; activating it as the default
requires the matching OpenClaw shard consumer.

The complete plugin and skill snapshot roots are
`/api/v1/feeds/plugins/root` and `/api/v1/feeds/skills/root`. Roots are DSSE
signed with distinct payload types and list absolute HTTPS shard URLs, exact raw
byte lengths, entry counts, and lowercase SHA-256 digests. Shards are served at
`/api/v1/feeds/{plugins|skills}/shards/sha256-<digest>.json` with one-year
immutable caching. A consumer must verify the signed root before fetching a
shard, then verify the shard's exact response bytes against the root descriptor
before parsing JSON. Shards are not independently signed.

Publication writes every bounded shard before marking its root ready, so a root
never advertises an incomplete set. A recoverable 30-minute lease serializes
scheduled and direct publication actions across the multi-mutation build. A
shard is at most 1 MiB and 10,000 entries;
a root is at most 1 MiB, 1,024 shards, and 1,000,000 entries; the aggregate
described shard bytes are at most 256 MiB. Empty snapshots have an empty shard
list. ClawHub currently targets at most 900 KiB of payload per shard so the
containing Convex document remains below its storage limit. Ready roots and
their immutable shards are retained for 30 days. Lightweight descriptor rows
are stored separately from shard payloads, so serving a root does not read the
catalog's full payload bytes into one Convex transaction.

### Activation boundary

Deploying this code does not enable signing and does not require a production
key. The existing unsigned response remains the default before and after this
change, including when the signing configuration is absent or invalid. Signing
is active only for clients that explicitly request `application/vnd.dsse+json`
and only after `CLAWHUB_FEED_SIGNING_CONFIG` is installed. This lets the signing
foundation and dependent feed transport changes merge and receive review before
operators provision a key and OpenClaw ships the matching trust anchor.

`GET /api/v1/feeds/plugins/changes?fromSequence=<n>&limit=<1..500>` returns the
signed plugin changes after `fromSequence` through a `toSequence` pinned when
the first page is requested. It reports the exact `changeCount`; every revision
in the range has at least one ordered upsert, remove, or metadata record. A
continuation request supplies only the opaque `cursor`. The five-minute signed
cursor binds the feed id, range, exact count, Convex cursor, limit, page index,
start index, and expiry, so clients cannot alter pagination or drift onto a
newer publication mid-chain.

Change pages use the
`openclaw.official-external-plugin-catalog-changes.v1` DSSE payload type,
`Cache-Control: no-store`, at most 500 records, and a 1 MiB signed-response
limit. If retention can no longer cover the pinned range, the same endpoint
returns a signed `409 resetRequired` payload whose same-origin `snapshotUrl`
points to `/api/v1/feeds/plugins`. Invalid or expired cursors are never treated
as unsigned pagination state.

`GET /api/v1/feeds/plugins/query` accepts at least one normalized `q`, `type`,
`state`, or `publisherId` filter plus an optional `limit=<1..200>`. The first
request pins the latest indexed revision, materializes the complete ordered
result in bounded database scans, and records the exact `resultCount` before
serving a page. It never parses and filters the full stored snapshot at request
time. Continuations supply only the opaque `cursor`; its five-minute signed
state binds the normalized query, revision, materialization, exact count,
database cursor, limit, page index, start index, and expiry.

Query pages use the
`openclaw.official-external-plugin-catalog-query-results.v1` DSSE payload type,
`Cache-Control: private, no-store`, at most 200 entries, and a 1 MiB signed
response limit. Expired or unavailable materializations return `409`; invalid
or modified cursors return `400`. Query indexes follow the same 30-day revision
retention as change history, while result materializations expire after five
minutes.

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

1. Choose a stable, non-secret key id such as `clawhub-feed-2026-q3`. Record the
   owner, creation time, intended deployment, and rotation contact in the
   operator secret inventory.
2. On an approved operator machine with production Convex access, prepare a
   dedicated Ed25519 key pair without writing or printing the private key:

   ```powershell
   bun run provision:catalog-feed-key -- prepare `
     --key-id clawhub-feed-2026-q3 `
     --public-key-out .\clawhub-feed-public.pem `
     --prod
   ```

   Preparation stores the key id and private PEM together in the non-active
   `CLAWHUB_FEED_SIGNING_PENDING_CONFIG` secret and emits only the public key
   and fingerprint. For a non-production deployment, use `--deployment <name>`
   instead of `--prod`.

3. Confirm only the variable names, not their values:

   ```bash
   bunx convex env list --names-only --prod
   ```

4. Provide `clawhub-feed-public.pem`, its reported fingerprint, and the key id
   to the OpenClaw maintainer
   bundling the `clawhub-public` trust profile. The private PEM never leaves
   ClawHub's operator-controlled secret path.
5. After the matching OpenClaw trust anchor is released, activate the reviewed
   public key:

   ```powershell
   bun run provision:catalog-feed-key -- activate `
     --key-id clawhub-feed-2026-q3 `
     --public-key .\clawhub-feed-public.pem `
     --prod `
     --verify-url https://clawhub.ai/api/v1/feeds/plugins
   ```

   Activation reads the pending secret into process memory, derives its public
   key, and requires it to match the reviewed file before atomically replacing
   `CLAWHUB_FEED_SIGNING_CONFIG`. It removes the pending secret only after the
   active write succeeds.

6. Publish a fresh `clawhub-official` snapshot and verify that
   an `Accept: application/vnd.dsse+json` request to `/api/v1/feeds/plugins`
   returns an envelope whose decoded payload bytes equal the stored publication
   and whose signature verifies with the handed-off public key. Older unsigned
   clients continue receiving the unsigned representation during migration.

### Normal rotation

1. Run the `prepare` command with a new key id and public-key output path. This
   changes only `CLAWHUB_FEED_SIGNING_PENDING_CONFIG`; the active signer remains
   unchanged.
2. Bundle the new public key and recorded fingerprint in OpenClaw while the old
   key remains trusted.
3. After that trust update is released, run `activate` with the same key id and
   reviewed public-key file. Never activate before the trust overlap is live.
4. Verify a higher-sequence publication under the new key before retiring the
   old private key.
5. Remove the old public key in a later OpenClaw release after the supported
   client overlap window.

The first signer emits one signature, so it cannot provide an old-and-new
dual-sign overlap by itself. If operational policy requires dual signing, add
multi-key signer support before beginning that rotation.

### Emergency revocation

Remove `CLAWHUB_FEED_SIGNING_CONFIG` or replace it with a new matched pair in
Convex immediately. An absent signing configuration makes opted-in signed
requests return `503 no-store` while the unsigned compatibility representation
remains available. Notify OpenClaw maintainers to remove the compromised public
key through the authenticated release channel. Do not recover by advertising a
new public key from a feed-adjacent endpoint.
