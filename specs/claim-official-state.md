---
summary: "Claim, verification, official, suspension, and revocation state for ClawHub publishers."
read_when:
  - Changing publisher claim, verification, official, suspension, or revocation behavior
  - Adding account feed or publisher feed status fields
  - Reviewing trust labels shown on ClawHub profiles, feeds, search, or OpenClaw exports
---

# Claim And Official State

ClawHub publisher state must separate identity, policy, and safety signals.
Users should be able to understand whether a publisher is claimed, verified,
official, suspended, revoked, reviewed, scanned, or locally approved without
those labels collapsing into a single trust badge.

This spec defines the product-state boundaries for account and publisher feeds.
It does not change the existing official publisher policy in
`specs/official-publishers.md`; it records how claim, verification, official,
suspension, and revocation states should relate as ClawHub grows account-backed
feeds and follow surfaces.

## State Definitions

ClawHub should keep these states distinct:

- `unclaimed`: no current ClawHub account has established ownership or
  representation of the account or publisher identity.
- `claimPending`: a claim request exists, but staff or automated verification
  has not accepted it.
- `claimed`: ClawHub has linked the publisher or namespace to a ClawHub account
  or organization, but has not granted a stronger verification signal.
- `verified`: ClawHub has accepted evidence that the account or publisher
  represents the claimed identity.
- `official`: ClawHub staff have granted official publisher status under the
  policy in `specs/official-publishers.md`.
- `suspended`: ClawHub has temporarily restricted the publisher or related
  feed/profile surfaces because of policy, security, abuse, or account-risk
  concerns.
- `revoked`: ClawHub has removed a previous claim, verification, official
  status, or feed eligibility decision.

These names are product-state labels, not necessarily one stored enum. Existing
tables may keep separate rows or fields for claims, publisher membership,
official publisher rows, moderation holds, deleted/deactivated state, and audit
history.

## Boundaries

`official` means official in ClawHub only. It does not mean:

- OpenClaw reviewed
- OpenClaw scanned
- locally approved
- safe to install
- exempt from package artifact integrity checks
- exempt from moderation or security review

Ordinary community publishing must not require official status. Official status
is a stronger signal for selected publishers, not the baseline path for account
feeds, publisher profiles, search visibility, or package publication.

Uploaded skill, package, feed, or profile metadata must not be able to mark a
publisher as claimed, verified, official, suspended, or revoked. Those states
must come from ClawHub-controlled account, staff, policy, moderation, or audit
paths.

## Transition Rules

Self-service paths may create or update:

- claim requests
- account profile metadata
- publisher profile metadata
- ordinary public package or skill publication
- follow state

Self-service paths must not directly grant:

- verified state
- official state
- suspension
- revocation
- reinstatement after suspension or revocation

Staff or system-controlled paths should define the actor, proof type, reason,
and affected identity for each transition before implementation.

Revoked or suspended publishers should remain resolvable for audit history.
Their public profile or feed may show a restricted state, but URLs should not be
reused in a way that makes old feed entries or audit records point at an
unrelated identity.

## Display Rules

ClawHub UI and feed fields should use separate labels for:

- claimed
- verified
- official
- OpenClaw reviewed
- OpenClaw scanned
- locally approved

Do not collapse them into one trust badge. A user who sees `official` should not
read it as `OpenClaw scanned`, `reviewed`, `locally approved`, or `safe to
install`.

Profile, feed, and search surfaces should:

- show claim and official status separately
- show scan or review state only when ClawHub has that state
- show local approval only when the current context actually has that approval
- preserve historical provenance when a state changes
- keep suspended or revoked publishers visibly restricted instead of active or
  endorsed

## Feed Behavior

Future account and publisher feeds should include only ClawHub-authored state
facts. Feed consumers should treat those facts as inputs to their own trust
model, not as install authority.

When state changes:

- official grants and removals should affect future feed snapshots
- suspensions and revocations should affect future feed snapshots
- historical feed revisions should remain auditable
- followers may be notified about material restriction changes, but the
  notification must not imply install safety

If a publisher is suspended or revoked, feed endpoints should return a
well-defined restricted state or error response without exposing private review
evidence.

## Audit Requirements

Record audit events for:

- claim request created
- claim accepted
- claim rejected
- verification granted
- verification removed
- official status granted
- official status removed
- publisher suspended
- publisher reinstated
- publisher revoked
- feed eligibility restricted or restored because of claim, official, security,
  or moderation state

Each audit event should include:

- actor
- timestamp
- affected account id or publisher id
- prior state
- new state
- reason
- proof type when applicable
- related feed revision when applicable

Private proof material should not be copied into public feeds, profile payloads,
or user-facing audit summaries.

## Open Questions

- What proof types should be accepted for account or publisher claims?
- Which claim decisions are staff-only, and which can be automated?
- Does verified state apply to accounts, publishers, namespaces, or all three?
- Should official state remain publisher-only, matching the current
  `officialPublishers` contract?
- What correction or appeal path exists after suspension or revocation?
