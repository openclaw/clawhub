---
summary: "ClawHub account and publisher feed model for OpenClaw discovery."
read_when:
  - Adding account-backed or publisher-backed feed APIs
  - Changing ClawHub publisher identity, profile, or feed projection behavior
  - Wiring OpenClaw clients to ClawHub account or publisher feeds
---

# Account Feeds

ClawHub account feeds are stable, ClawHub-authored projections of public account
and publisher activity for OpenClaw discovery.

They are not a replacement for the hosted catalog feed in
`specs/hosted-catalog-feed.md`. They give OpenClaw clients and ClawHub users a
way to follow a person, organization, or publisher identity and discover that
publisher's public work through a stable machine-readable feed.

## Model

ClawHub should treat account identity and publisher identity as related but
separate product facts:

- An account is the signed-in ClawHub user or organization record.
- A publisher is the public identity that owns packages, skills, and profile
  surfaces.
- A publisher may be backed by a personal account or an organization account.
- Feed URLs and feed ids must use stable opaque ids, not mutable display names,
  handles, slugs, or profile URLs as authority.
- Display names, handles, avatars, and profile copy are presentation fields and
  may change without changing feed identity.

The first account-feed contract should support both account-scoped and
publisher-scoped feeds until product usage proves one is unnecessary.

First-slice public endpoints:

- `GET /api/v1/accounts/{accountId}`
- `GET /api/v1/accounts/{accountId}/feed`
- `GET /api/v1/publishers/{publisherId}`
- `GET /api/v1/publishers/{publisherId}/feed`

The account and publisher detail endpoints should expose enough public metadata
for clients to display identity, profile links, and follow state. The feed
endpoints should expose ordered public feed entries for discovery.

The initial implementation is an unsigned, bounded, live projection over active
public accounts, publishers, skills, and packages. It does not add official
state, registry review state, follow state, scan authority, install authority,
or feed signing. Signed ClawHub envelopes and publication cache semantics remain
future trust-stack work.

## Feed Shape

Draft feed metadata:

```json
{
  "schemaVersion": 1,
  "feedId": "clawhub.account.<stable-id>",
  "scope": "publisher",
  "publisherId": "publishers:<stable-id>",
  "accountId": "users:<stable-id>",
  "displayName": "Example Publisher",
  "generatedAt": "2026-07-01T00:00:00.000Z",
  "sequence": 0,
  "entries": [],
  "nextCursor": null
}
```

Required stable fields:

- `schemaVersion`: feed wire version.
- `feedId`: stable feed identity.
- `accountId`: stable account identity when the feed is account-scoped.
- `publisherId`: stable publisher identity when the feed is publisher-scoped.
- `generatedAt`: generation time for this feed body.
- `sequence`: monotonic feed sequence for cache, replay, and rollback checks.
- `entries`: ordered public entries.
- `nextCursor`: reserved for future pagination; `null` in the first API slice.

The feed body should not include credentials, private source URLs, bootstrap
trust keys, unpublished package metadata, or reviewer-only moderation details.

## Signing And Cache Boundaries

Account feed authenticity comes from a ClawHub-authored feed envelope, not from
user-submitted feed contents.

The signed material should include:

- feed id
- schema version
- sequence
- generated time
- previous sequence or previous feed revision when available
- envelope key id
- exact feed payload digest

Persisted feed bodies are cache material. They become useful for OpenClaw only
after envelope verification and source-profile trust checks in the OpenClaw
client. A cached feed body alone must not grant install eligibility or create a
new trust root.

ClawHub should define pagination or continuation semantics before this becomes
a public API. A popular publisher should not require clients to fetch an
unbounded feed.

## Identity And Trust Boundaries

Account feed support must keep these signals separate:

- publisher identity
- claimed account state
- verified account state
- ClawHub official publisher state
- OpenClaw registry review state
- local approval state
- scan state
- package artifact integrity
- OpenClaw install eligibility

Following a feed is a discovery and notification signal only. It must not imply
official status, registry inclusion, local approval, scan success, package
integrity, or install eligibility.

Official publisher state remains governed by `specs/official-publishers.md`.
Uploaded skill or package metadata must not be able to mark a publisher or feed
official.

## API Requirements

The public API contract should define:

- stable ids and canonical URLs
- pagination and continuation tokens
- cache validators and max-age behavior
- monotonic sequence behavior
- idempotent client refresh behavior
- error responses for missing, private, suspended, revoked, or stale feeds
- replay and backfill behavior for clients that miss updates
- rate limits for feed reads and follower-triggered refreshes

Errors should distinguish "not found", "not public", "temporarily unavailable",
and "publisher suspended or revoked" without exposing private review evidence.

## Skill Author Experience

The first publisher setup path should be short and obvious in ClawHub:

1. Sign in.
2. Confirm or create a publisher identity.
3. Publish public work.
4. See the publisher profile and feed URL.

Ordinary community publishing must not require official status. Official,
reviewed, scanned, and locally approved states are stronger signals layered on
top of the normal publishing path.

## Audit Requirements

ClawHub should record audit events for trust-changing feed operations:

- feed signing key changes
- feed publication sequence changes
- account-to-publisher link changes
- publisher ownership changes
- visibility changes
- suspension, revocation, and reinstatement
- OpenClaw registry export events

Each event should include actor, time, reason, affected ids, prior state, new
state, and the related feed revision when applicable.

## Open Questions

- Are account ids and publisher ids already distinct enough in current ClawHub
  data, or does this require a schema clarification first?
- Should OpenClaw consume publisher-scoped feeds before account-scoped feeds?
- What is the public/private visibility model for account metadata?
- Should account feed entries include packages and skills from day one, or start
  with one content type?
- Which existing profile URLs become the canonical human-readable feed surface?
