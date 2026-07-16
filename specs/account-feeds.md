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

## Future Signing

Publisher feeds may later use the same dedicated ClawHub platform feed-signing
key as the public catalog, but require a distinct publisher-feed payload type
and expected feed-id binding. The catalog payload type must not be reused.
