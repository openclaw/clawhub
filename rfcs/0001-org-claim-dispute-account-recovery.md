# RFC 0001: Org Claim Disputes and Account Recovery After Owner-Initiated Deletion

Status: Draft

Audience: Community review

Canonical docs target: TBD

## Context

ClawHub needs a transparent process for two related trust and ownership questions:

- how organization or owner namespace claims are evaluated and disputed
- how account recovery works after an owner-initiated account deletion

This RFC is a lightweight discussion record. It is not the final policy, and it should eventually be replaced by a public docs page once the decision is accepted.

## Goals

- Give the community a clear place to review and comment before policy is finalized.
- Make owner namespace claims, disputes, and account recovery predictable.
- Separate public policy from private reviewer-only checks or sensitive evidence handling.

## Non-goals

- Define every internal moderator or admin runbook step.
- Publish private account, identity, or dispute evidence.
- Decide implementation details for every API, CLI, or admin-console change.

## Open Questions

- What evidence should be required to claim an organization or owner namespace?
- What evidence should be required to dispute an existing claim?
- What should happen when a namespace maps to a deleted or inactive owner account?
- What recovery path should exist after an owner intentionally deletes their account?
- Which decisions should be public docs, and which details should stay in an internal reviewer runbook?
