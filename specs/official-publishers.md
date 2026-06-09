# Official Publishers

`official` is a ClawHub publisher policy flag derived from ClawHub-managed
`officialPublishers` rows.

For now, Official means:

- a publisher is Official only when that exact publisher has an
  `officialPublishers` row
- official status is publisher-scoped; it is not inherited by users, personal
  publishers, org members, GitHub identities, OIDC trust, or `trustedPublisher`

Official must not be accepted from uploaded skill or package metadata.
Membership in an official org does not make a member's personal publisher
Official. There is no generic public endpoint for marking arbitrary publishers
Official.

The same policy signal appears in several places:

- Publisher/profile UI: official publishers show an `Official` badge.
- Owned package UI: new public packages from Official publishers use the
  `official` channel; private packages stay private.
- Public owner metadata: public skill search, skill detail, package detail,
  and plugin detail responses may expose `owner.official: true` when the owner
  publisher has an exact `officialPublishers` row.
- Public badge UI: skill list rows/cards, skill detail owner metadata, and
  plugin detail owner metadata may show the compact `Official` badge from
  `owner.official`.
- GitHub Skill Sync UI/backend: only manageable Official publishers can
  configure source-backed GitHub skill sync.
- Publisher abuse scoring: Official org publishers are excluded from bulk
  publisher-abuse scoring, nomination queues, and stale nomination actions.

Public consumers must treat `owner.official` as a positive-only trust signal:
`true` means the exact owner publisher has an `officialPublishers` row; absence
or `false` means no Official status is exposed for that owner. Public API and UI
surfaces must not infer Official status from org membership, uploaded metadata,
GitHub identity, OIDC trust, or `trustedPublisher`.

`trustedPublisher` is an internal automated-publish permission. It does not make
a publisher or package Official.
