---
summary: "Plan for orgs, publisher membership, and scoped @owner/name identities."
read_when:
  - Implementing orgs or publisher membership
  - Changing skill or package ownership semantics
  - Migrating routes or APIs to scoped identities
---

# Orgs And Scoped Names

## Goal

Add real multi-member orgs and make `@owner/name` the canonical identity for
published content.

This is not just a collaboration feature. It is an ownership and namespace
migration.

## Product Decisions

### Canonical identity

- Canonical registry identity: `@owner/name`
- `owner` is a publisher handle
- `name` is a local name inside that publisher namespace
- Users and orgs both publish through the same publisher abstraction
- New content is always scoped
- Legacy unscoped names remain compatibility aliases only when resolution is
  unambiguous

### Publisher model

- A publisher is either a personal publisher or an org publisher
- Every user gets a personal publisher
- Org publishers can have multiple members
- Content is owned by a publisher, not directly by a user
- Audit actor stays user-level

### Organization branding

- Org logos are uploaded by an owner or admin as PNG, JPEG, or WebP files up to
  2 MB.
- Uploaded logos are stored in Convex storage and rendered through a cached
  storage URL; new profiles do not hotlink arbitrary image hosts.
- Legacy URL-backed images remain readable until an org replaces or removes
  them.

### Scope of change

- Skills: yes
- Packages: yes

Avoid split models like "skills stay user-owned, packages become org-owned".
That creates permanent complexity in auth, routes, and migrations.

## Why This Requires A Real Migration

Today the system is globally named and single-owner.

- Skills store `ownerUserId` and are looked up by global `slug`
- Packages store `ownerUserId` and are looked up by global `normalizedName`
- Skill/package digests denormalize owner handle from a user row
- Permissions use direct `ownerUserId === userId` checks
- Transfer flows are user-to-user only

With `@owner/name`, owner becomes part of identity, not just presentation.

## Target Model

### Publishers

Add `publishers`.

Suggested fields:

- `kind`: `user | org`
- `handle`
- `displayName`
- `bio`
- `image`
- `linkedUserId?`
  - set for personal publishers
  - unset for org publishers
- `trustedPublisher`
- `deactivatedAt?`
- `deletedAt?`
- `createdAt`
- `updatedAt`

Indexes:

- `by_handle`
- `by_linked_user`
- `by_kind_handle`

### Publisher members

Add `publisherMembers`.

Suggested fields:

- `publisherId`
- `userId`
- `role`: `owner | admin | publisher`
- `createdAt`
- `updatedAt`

Indexes:

- `by_publisher`
- `by_user`
- `by_publisher_user`

### Optional: publisher invites

Add later if needed:

- `publisherInvites`
- email or GitHub-login based invite target
- inviter user id
- target publisher id
- role
- token / expiry / status

Keep this out of the first migration if it slows down ownership work.

## Ownership Changes

### Replace direct user ownership

Content tables should move to `ownerPublisherId`.

Affected tables:

- `skills`
- `packages`
- search digest tables
- slug/name alias tables
- transfer tables
- backup metadata payloads if they persist owner identity

Keep actor fields user-level:

- `createdBy`
- `updatedBy`
- audit log actor

### Transition strategy

Do not hard-cut immediately.

Use dual fields during rollout:

- add `ownerPublisherId`
- keep `ownerUserId` temporarily
- dual write
- migrate read paths
- backfill digests
- remove `ownerUserId` from hot paths later

### Lifecycle permissions

- Skills and packages use the same publisher-admin ownership boundary.
- Publisher owners/admins may manage user lifecycle actions for content owned by
  that publisher: rename, transfer into another publisher they administer,
  soft-delete, and restore.
- Org deletion is owner-only and self-serve from account settings. It marks the
  org publisher `deletedAt` and `deactivatedAt`, keeps membership/audit/resource
  rows, and soft-deletes resources owned through that `ownerPublisherId`.
- Org deletion cascades must hide both skills and packages/plugins from public
  browse, detail, install, and API surfaces. Skills use
  `moderationReason = "publisher.deleted"` and packages use
  `softDeletedReason = "publisher.deleted"`; package publish tokens are revoked
  when present.
- Account deletion must hide the user's personal publisher resources and must
  delete sole-owner org publishers through the same soft-delete cascade.
  Multi-owner orgs remain active because another owner can still manage them.
- Platform moderators/admins may still perform moderation actions, but a normal
  publisher-admin restore must not lift scanner, moderator, ban, or security
  hides.
- Direct skill moves to org publishers are allowed only when the actor can
  administer both the current owner and destination publisher. User-to-user skill
  transfers remain recipient-accepted unless the actor controls the destination
  publisher.
- Ownership transfer paths must not move hidden, removed, suspicious, or
  malicious skills. The narrow exception is a platform-admin publisher recovery
  that directly relocates a clean, owner-deleted skill without restoring it. The
  current hide must have been written by a non-staff owner or publisher admin,
  proven by the matching `skill.delete` audit event at the current deletion
  timestamp; the platform admin must explicitly select an active destination,
  and the audited transfer must include a reason. Moderator, scanner, ban,
  security, merge, and unknown-provenance hides remain blocked.

## Naming Rules

### New uniqueness rules

- Skill uniqueness: `(ownerPublisherId, slug)`
- Package uniqueness: `(ownerPublisherId, normalizedName)`

### Legacy compatibility

Existing global names become legacy aliases.

Rules:

- old `/api/v1/skills/{slug}` can continue only if exactly one live scoped skill
  matches that slug
- if multiple scoped skills share the same local name, old unscoped lookup must
  stop pretending there is one canonical answer
- web redirects from legacy URLs should only happen when target resolution is
  unambiguous

### Reserved handles

Handle reservation must move from user-centric to publisher-centric.

Current reservation logic is anchored to rightful owner user id. Replace with
publisher-aware reservations so org handles are first-class.

Platform route/system handles such as `admin`, `plugins`, and `skills` are not
owned by users or orgs. They must be blocked by route reservation policy instead
of represented as empty publisher rows.

## Routing

### Web routes

Keep human-readable web routes:

- `/$owner/$name`

Examples:

- `/openai/chatgpt`
- `/steipete/peekaboo`

This matches the canonical `@owner/name` identity without exposing `@` in page
paths.

### CLI and API locators

CLI and machine-facing APIs should accept:

- `@owner/name`

Examples:

- `clawhub inspect @openai/chatgpt`
- `clawhub install @steipete/peekaboo`

### Owner lookup

Owner is no longer decorative.

Current route behavior often resolves by slug and then redirects owner to the
canonical handle. After migration:

- route lookup must resolve by owner + local name
- wrong owner should 404 or redirect only through explicit alias records
- owner is part of primary key semantics

## Publisher Permissions

Replace direct ownership checks with publisher membership checks.

Suggested helpers:

- `requirePublisherMember(publisherId)`
- `requirePublisherRole(publisherId, ["owner", "admin"])`
- `canPublishAsPublisher(userId, publisherId)`
- `canManageOwnedResource(userId, ownerPublisherId)`

Role semantics:

- `owner`: full control, manage members, transfer ownership, delete publisher
- `admin`: manage content and members except destructive publisher-level actions
- `publisher`: publish new versions, update metadata, no membership changes

Moderators/admins keep global override powers as they do today.

Membership management is only valid for `kind: "org"` publishers. Personal
publishers (`kind: "user"`) are identity aliases for one linked user; they keep
a single owner membership row for compatibility with publisher-aware ownership
checks, but authorization must key off `linkedUserId`, not extra membership
rows. Public member add mutations must not treat personal publishers as
organizations; remove mutations may only let the linked user clean up stale
extra membership rows.

Skill slug merges are content-management operations. They must authorize through
publisher ownership, not only `ownerUserId`, so org owners/admins can merge two
skills owned by the same manageable publisher. Merge aliases must keep both
`ownerUserId` and `ownerPublisherId` aligned to the live target skill.

## Publishing Flow Changes

### Skills

Skill publishing is publisher-aware for normal publishes and explicit owner
migration.

- actor selects publisher in UI/CLI
- publish mutation validates publisher membership
- resource stores `ownerPublisherId`
- version keeps `createdBy`
- if the selected publisher differs from the existing skill owner, the request
  must include `migrateOwner: true`
- owner migration requires admin or owner access on both the current publisher
  and the destination publisher
- migration preserves the skill id, versions, stats, forks, aliases,
  search digest identity, and audit history
- migration writes a `skill.ownership.migrate` audit event; the new version's
  `createdBy` remains the publishing actor

### Packages

Package publish already has a primitive shared-owner path via `ownerHandle`, but
it is admin-only.

Replace that with:

- `ownerHandle` resolves to publisher handle
- allowed for publisher members
- no admin impersonation required for normal org publishing

### Upload UI

Add owner selector to:

- upload page
- package publish page
- dashboard quick actions

Selector rules:

- default to personal publisher
- list orgs where actor is member
- hide publishers where actor cannot publish

## API Changes

### Read APIs

Add scoped read shape.

Preferred new endpoints:

- `GET /api/v1/skills/@{owner}/{name}`
- `GET /api/v1/skills/@{owner}/{name}/versions`
- `GET /api/v1/packages/@{owner}/{name}`
- `GET /api/v1/packages/@{owner}/{name}/versions`

Alternative if path encoding is awkward:

- `GET /api/v1/skills/{owner}/{name}`
- `GET /api/v1/packages/{owner}/{name}`

Keep one canonical format internally. Do not support multiple equivalent primary
keys forever.

### Search/list APIs

Search/list responses should return publisher identity explicitly.

Suggested fields:

- `owner`
  - `handle`
  - `displayName`
  - `kind`
  - `image`
- `locator`
  - `scoped`: `@owner/name`
  - `path`: `/owner/name`

### Publish APIs

Publish payloads should take:

- `ownerHandle`
- `migrateOwner`

Semantics:

- resolve to publisher
- validate membership
- reject unknown publishers
- reject insufficient role
- reject owner changes unless `migrateOwner === true`

## Transfer Model

Current transfers are user-to-user only. That is too narrow.

New transfer target should be a publisher.

Support:

- user publisher -> org publisher
- org publisher -> user publisher
- org publisher -> org publisher

Transfer acceptance rule:

- actor must have `owner` or `admin` on target publisher

Audit should record:

- actor user id
- source publisher id
- target publisher id
- resource id

## Search Digest Changes

Digest rows should stop denormalizing only user ownership.

Add publisher projection fields:

- `ownerPublisherId`
- `ownerHandle`
- `ownerDisplayName`
- `ownerKind`
- `ownerImage`

Do not join hot-path list views against publisher + content + version unless
necessary. Keep digest-first reads.

## Backfill Plan

### Phase 0: schema

- add `publishers`
- add `publisherMembers`
- add `ownerPublisherId` to content + digests
- add publisher-aware indexes

### Phase 1: bootstrap personal publishers

- create one personal publisher per existing user
- set `linkedUserId`
- create `publisherMembers` row with role `owner`

### Phase 2: content backfill

- backfill `ownerPublisherId` from `ownerUserId`
- backfill digest owner publisher fields
- backfill alias tables if needed

Production cleanup uses targeted `maintenance:repairLegacyPublisherOwnershipForUser` canaries.
It patches one active user at a time across `skills` and `packages`, scheduling
the next phase when requested.

Run with `dryRun: true` and `scheduleNext: false` before apply. The repair must
skip deleted, deactivated, and purged users. Apply-mode failures should abort
the current mutation so Convex rolls back any partial owner projection,
trigger-owned digest/stat, or content updates for that batch.

### Phase 3: dual read/write

- all writes set both old and new ownership fields
- reads prefer `ownerPublisherId`
- UI uses publisher handles

### Phase 4: scoped routing and APIs

- add scoped resolvers
- update CLI to parse `@owner/name`
- update web routes to rely on owner + name

### Phase 5: cleanup

- stop using `ownerUserId` in permission checks
- remove legacy fallbacks from hot paths
- keep compatibility alias endpoints only where still useful

## Compatibility Policy

### New writes

- new content must use publisher ownership
- new locators returned by UI/API/CLI should be scoped

### Old reads

Temporary compatibility allowed for:

- existing user profile links
- old unscoped API calls
- old CLI invocations without `@owner/`

Compatibility should have clear limits:

- only when resolution is unambiguous
- return canonical scoped locator in responses
- do not allow old format to remain canonical in docs or new UI

## UI Surfaces

Need updates in:

- dashboard
- upload
- package publish flow
- skill/package cards and detail pages
- owner profile pages
- settings

New UI surfaces:

- org profile page
- org settings
- org members management
- create org flow

## Suggested Delivery Order

1. Add publisher schema and personal publisher backfill
2. Add owner publisher fields and dual-write support
3. Switch auth helpers and permission checks
4. Switch digests and list/search outputs
5. Add owner selector in publish flows
6. Add scoped CLI/API parsing
7. Add org management UI
8. Migrate transfers to publisher targets
9. Remove legacy ownership assumptions

## Testing Plan

Add or update tests for:

- personal publisher bootstrap
- org creation
- membership role enforcement
- publish-as-org for skills
- publish-as-org for packages
- scoped uniqueness
- legacy alias resolution
- ambiguous unscoped lookup failure
- transfer user -> org
- transfer org -> user
- transfer org -> org
- dashboard/upload owner selection
- search/list digest hydration with publisher owners

## Non-Goals For First Pass

- npm-style team subgroups inside orgs
- package-level ACLs separate from org membership
- invite workflows with complex approval states
- org billing or paid features
- multiple namespace syntaxes

## Open Implementation Notes

- Canonical page URL should stay readable: `/owner/name`
- Canonical machine locator should be `@owner/name`
- Keep one internal parser/formatter for locators so CLI, API, and UI do not
  drift
- Do not keep slug-only and scoped lookup logic equally primary; one must win
- Prefer publisher abstraction over `ownerUserId | ownerOrgId` unions
