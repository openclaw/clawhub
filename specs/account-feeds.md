---
summary: "ClawHub publisher feed model for public discovery."
read_when:
  - Adding or changing publisher feed APIs
  - Changing publisher identity or visibility
  - Wiring clients to publisher feeds
---

# Publisher Feeds

ClawHub publisher feeds are machine-readable discovery projections of a
publisher's public skills and plugins. Publishers are the public identity for
both people and organizations; there is no parallel public account-feed API.

Publisher feeds do not grant trust, approval, scan success, artifact integrity,
or install authority. Consumers resolve an entry through an accepted catalog
before installation.

## Routes

```text
GET /api/v1/publishers/{publisherId}
GET /api/v1/publishers/{publisherId}/feed?limit=50&cursor=<opaque>
```

The detail route returns bounded public publisher fields and the canonical feed
URL. It does not expose linked-user, owner, member, authentication, or moderation
records.

## Identity

Feed identity is stable and publisher-only:

```text
clawhub.publisher.<publisherId>
```

Handles and display names may change without changing the feed id. Personal
publishers are visible only while their canonical linked or legacy owner user is
active. Legacy `ownerUserId` content remains discoverable during publisher
ownership migration and is deduplicated against `ownerPublisherId` rows.

## Revisions And Pagination

The first page builds a complete bounded publisher projection and publishes it
as an immutable logical revision in `publisherFeedPublications`. The sequence
increments only when publisher metadata or ordered entries change; unchanged
reads reuse the stored sequence and generation time.

Pages are slices of that stored revision. The opaque cursor binds:

- publisher id;
- feed sequence;
- next entry offset.

All pages therefore report the same `feedId`, `sequence`, and `generatedAt`.
If a newer first-page refresh replaces the stored revision, an old cursor
returns `409` and the client restarts from page one.

Source reads and snapshot size are bounded. If ClawHub cannot prove that the
projection is complete within those bounds, the first page returns `503
no-store`; it never publishes a terminal page that silently omits older public
entries.

## Query And Change Projections

The scalable distribution layer is built from internal projections before any
public signed route is exposed:

- `queryPublisherFeed` filters one stored coherent revision by normalized text
  and entry kind, returning a bounded deterministic slice, total count, and next
  offset;
- `getPublisherFeedChanges` returns complete changes after an accepted sequence
  through the current sequence, bounded by a stable global change number;
- missing revision or change history returns reset-required rather than a
  partial result.

Text queries normalize to NFC, trim and collapse the RFC-defined ASCII
whitespace set, preserve case in the signed query value, and use deterministic
case-insensitive matching. Query arrays are sorted and deduplicated.

These functions are internal on purpose. A follow-up route must bind their
offsets to integrity-protected cursors and sign the strict query/change payload
types with the shared ClawHub feed signer. There is no unsigned public query or
delta endpoint.

## Durable Change History

`publisherFeedPublications` remains the single current snapshot used by normal
feed reads. `publisherFeedRevisions` stores revision metadata and a cumulative
change count. `publisherFeedChanges` stores one append-only row per metadata
replacement, complete entry upsert, or removal tombstone.

Every changed publication increments sequence by exactly one and writes its
snapshot, revision row, and ordered change rows in one mutation. Existing
pre-history publications establish their current sequence as a zero-change
baseline; clients older than that baseline must reset. Delta reads validate
that every requested global change number is present before returning a page.

## Entry Shape

Entries contain only:

- `kind`: `skill` or `plugin`;
- stable object `id`;
- current `name`, `displayName`, and bounded `summary`;
- canonical public HTTPS or safe origin-relative `url`;
- finite non-negative `updatedAt` milliseconds.

Entries are ordered by descending `updatedAt`, then stable kind and object id.
Origin-relative URLs reject protocol-relative forms, backslashes, and control
characters before clients resolve them against the feed request origin.

## Follow Boundary

Following is social discovery only. Public follower/following lists and a
pull-based activity timeline belong in the follow stack. ClawHub should not
send one notification for every publisher upload. OpenClaw or Control UI may
notify locally when an update affects content installed in that instance.

## Signing Boundary

Publisher query and change pages use distinct payload types and expected
publisher-feed identity binding. They may use the same dedicated ClawHub
platform feed-signing key as the public catalog, but the catalog payload type
must not be reused. Public route wiring remains in the signer-dependent child
PR.
