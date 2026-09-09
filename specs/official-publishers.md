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

## Staff custody for curated company plugins

A staff-custodied company organization records the reviewed GitHub organization ID and ownership evidence. Establishing custody requires an active staff administrator and an organization whose members are all active staff, including an owner. Custody does not grant Official status; the existing official-publisher decision remains separate.

Company-authored imports require matching custody. Registry-authored imports retain the Cursor, OpenAI or Anthropic publisher and never acquire represented-company authorship from manifest branding. Curated provenance is a staff-only, typed release field, accompanied by `CLAWHUB_SOURCE.json` inside the scanned artifact. Source attribution, hashes and omitted capabilities remain part of immutable release history.

A company adopts custody through the existing publisher membership and connected GitHub organization verification flow. The claimant must own the publisher and have fresh administrator membership for the exact recorded GitHub organization ID. Adoption removes the custody disclosure and stops subsequent staff synchronization, including pending publications rechecked before becoming public. Existing moderation recovery remains the explicit override path. Adoption does not change package IDs or old releases.

Imported icons may point only at exact-commit files preserved within the MIT-licensed source closure. External image URLs are omitted and recorded; imports do not scrape company logos.
