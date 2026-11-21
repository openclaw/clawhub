# Official Publishers

`official` is a ClawHub publisher policy flag derived from ClawHub-managed
`officialPublishers` rows.

For now, Official means:

- a publisher is Official only when that exact publisher has an
  `officialPublishers` row
- official status is publisher-scoped; it is not inherited by users, personal
  publishers, org members, GitHub identities, OIDC trust, or `trustedPublisher`
- personal and org publishers can both be marked Official when ClawHub staff
  verify that publisher identity

Official must not be accepted from uploaded skill or package metadata.
Membership in an official org does not make a member's personal publisher
Official. There is no generic public endpoint for marking arbitrary publishers
Official.

The same policy signal appears in several places:

- Publisher/profile UI: official publishers show an `Official` badge.
- Owned package UI: new public packages from Official publishers use the
  `official` channel; private packages stay private.
- GitHub Skill Sync UI/backend: only manageable Official publishers can
  configure source-backed GitHub skill sync.
- Publisher abuse scoring: Official publishers are excluded from bulk
  publisher-abuse scoring, nomination queues, and stale nomination actions.

`trustedPublisher` is an internal automated-publish permission. It does not make
a publisher or package Official.

## Directory pagination

The Official directory keeps the current search's rows, cursor, and loading state
together. A new first page invalidates any earlier pagination request. Only the
current request may append rows, replace the cursor, or clear the loading state;
a late response must not mix searches or unlock another request. Manual loading
and the intersection observer share the same in-flight request fence.
