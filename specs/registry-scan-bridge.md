---
summary: "OpenClaw registry review and scan bridge for ClawHub account and publisher feeds."
read_when:
  - Exporting ClawHub account or publisher feed entries to OpenClaw review
  - Reflecting OpenClaw registry, review, or scan state back into ClawHub
  - Changing feed, scan, provenance, or install-eligibility boundaries
---

# Registry And Scan Bridge

ClawHub account and publisher feeds can provide useful candidate data for
OpenClaw registry review, but they must not bypass OpenClaw review, scans,
package integrity checks, source-profile trust, or local policy.

This spec defines the bridge boundary between ClawHub feed facts and OpenClaw
registry decisions.

## Product Behavior

ClawHub may export account or publisher feed entries into an OpenClaw review
lane. The export is a candidate package, skill, or feed-entry record with
ClawHub provenance. It is not a registry inclusion decision.

OpenClaw review systems may preserve ClawHub provenance, feed revision metadata,
scan inputs, artifact details, and publisher state while making their own
review and inclusion decision.

Registry decisions may be reflected back to ClawHub as separate status fields.
They must not replace or mutate ClawHub official publisher state.

## Exported Facts

An export should carry explicit facts only:

- ClawHub export id
- ClawHub feed id
- ClawHub feed sequence or revision
- ClawHub feed payload digest when available
- account id
- publisher id
- package id, skill id, or feed entry id
- package name, slug, version, and source type when available
- artifact URL and artifact digest when available
- source URL and source revision when available
- ClawHub official publisher state when available
- ClawHub claim or verification state when available
- ClawHub scan state when available
- ClawHub review state when available
- export actor or system id
- export timestamp

The export should not carry inferred trust. For example, ClawHub official state
is a publisher identity signal, not an OpenClaw registry approval.

## Boundary Rules

Keep these signals separate:

- ClawHub publisher identity
- ClawHub claim state
- ClawHub verified state
- ClawHub official publisher state
- ClawHub scan state
- ClawHub review state
- OpenClaw registry review state
- OpenClaw scan state
- OpenClaw source-profile trust
- package artifact integrity
- local approval
- OpenClaw install eligibility

ClawHub official status is not OpenClaw approval. OpenClaw registry inclusion is
a downstream review result. Local approval is separate from OpenClaw registry
inclusion.

OpenClaw install eligibility remains gated by verified feed state,
source-profile trust, package integrity, OpenClaw review or scan requirements
where configured, and local policy.

## Review Flow

The bridge should support this flow:

1. ClawHub produces or refreshes an account or publisher feed.
2. ClawHub selects eligible public feed entries for export.
3. ClawHub creates an export record with explicit provenance and artifact facts.
4. OpenClaw review receives or fetches the export record.
5. OpenClaw review performs its own validation, scans, and policy checks.
6. OpenClaw review records a decision.
7. ClawHub may display that decision as OpenClaw review state, separate from
   ClawHub official state.

The bridge should be idempotent. Retrying the same export should not create
duplicate review candidates when the ClawHub feed revision and exported entry
are unchanged.

## Retry, Withdrawal, And Resubmission

The contract should define:

- export idempotency key
- duplicate submission behavior
- retry behavior after transient failures
- withdrawal behavior when a ClawHub entry is removed, hidden, suspended, or
  revoked
- resubmission behavior when the feed revision, artifact digest, source
  revision, or scan state changes
- stale decision behavior when the underlying ClawHub facts change

Withdrawal should not erase the previous decision history. It should produce a
new state that points back to the original export and decision where possible.

## Reflected Status

ClawHub may show reflected OpenClaw status such as:

- OpenClaw review pending
- OpenClaw reviewed
- OpenClaw rejected
- OpenClaw scan pending
- OpenClaw scan passed
- OpenClaw scan failed
- OpenClaw registry included
- OpenClaw registry removed

These are OpenClaw status fields. They should not be stored as ClawHub official
state and should not make the publisher official.

ClawHub should show reflected status only when it can tie the status back to the
exact ClawHub export id or feed revision that OpenClaw reviewed.

## Audit Requirements

Record audit events for:

- candidate exported
- export retried
- duplicate export suppressed
- export withdrawn
- export resubmitted
- OpenClaw decision received
- reflected status updated
- reflected status cleared because ClawHub facts changed

Each audit event should include:

- actor or system id
- timestamp
- export id
- feed id and feed revision
- account id or publisher id
- package, skill, or entry id
- prior state
- new state
- reason
- related OpenClaw review id when available

Private review evidence should not be copied into public feeds, profile
payloads, or search documents.

## Open Questions

- Which OpenClaw review API should receive ClawHub candidates first?
- Should OpenClaw pull export records from ClawHub, or should ClawHub push
  candidates into OpenClaw review?
- What minimum evidence package does OpenClaw need for the first candidate?
- Which ClawHub scan states are stable enough to export as facts?
- Should OpenClaw decisions be reflected on profile pages, package pages, feed
  pages, or all three?
