# RFC 0002: Content Policy Categories

Status: Pre-RFC sketch

Audience: Maintainer review before community RFC

Canonical docs target: `docs/acceptable-usage.md`

## Context

ClawHub needs a clearer content-policy frame for deciding which skills belong in
the public registry, which skills should be hidden or removed, and which uploads
need human review.

This is intentionally not a complete RFC yet. It is a lightweight template based
on the current category list so maintainers can agree on the shape before turning
it into a public policy proposal.

## Goals

- Turn the category list into clear review buckets.
- Separate low-quality or duplicate content from malicious or abusive content.
- Identify which categories should affect search visibility, registry inclusion,
  upload review, or account enforcement.
- Keep reviewer-only signals and exact detection tactics out of public policy.

## Non-goals

- Define every scanner threshold, review workflow, or ban runbook.
- Decide final enforcement severity for every category.
- Publish private reports, reporter identities, or sensitive audit details.
- Treat VirusTotal alone as a malicious-content source of truth.

## Draft Category List

| Category                                                                                          | Draft policy question                                                                           | Likely default treatment                                                                              | Notes                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Possibly spam: bulk accounts, bot accounts, test/junk                                             | Is this upload/account pattern primarily noise or automated registry abuse?                     | Hide from browse/search pending review; repeated or obvious abuse may lead to account action.         | Needs examples that distinguish harmless testing from bulk spam.                                                  |
| Duplicate or similar name                                                                         | Is this confusingly duplicative, impersonating another package/skill, or squatting on a name?   | Review for rename, removal, or ownership/namespace dispute path.                                      | May overlap with org/owner claim disputes in RFC 0001.                                                            |
| Low-quality or non-English descriptions                                                           | Is the listing too unclear for users to evaluate what it does?                                  | Prefer review guidance or reduced discovery before removal.                                           | Need to decide whether non-English content is allowed when metadata is complete and safe.                         |
| Crypto / blockchain / finance / trade                                                             | Does the skill enable financial advice, trading automation, scams, or deceptive money movement? | Review required; remove if the workflow is deceptive, risky without human approval, or scam-adjacent. | Legitimate wallet, accounting, analytics, or read-only tools need explicit allowed examples.                      |
| Malicious: identified by published researcher security audits, excluding VirusTotal-only findings | Is there credible public evidence that the artifact or author workflow is malicious?            | Hide/remove the artifact and consider account-level review.                                           | Public researcher evidence can support enforcement; VirusTotal telemetry alone should not be the deciding source. |
| Registry scope: not taken from OpenClaw's official skill registry                                 | Is this item outside the canonical registry source for the dataset or report?                   | Exclude from official totals and clearly label any separate analysis.                                 | This is a counting/source-of-truth rule, not necessarily a moderation violation.                                  |

## Draft Proposal Shape

ClawHub should define two related but separate decisions:

1. **Content policy decision**: whether the listing is allowed, disallowed, or
   review-required under the marketplace rules.
2. **Registry/reporting decision**: whether the listing counts toward official
   ClawHub/OpenClaw registry totals.

Policy text should explain user-visible outcomes in plain language:

- allowed
- allowed but lower-confidence or lower-discovery
- review-required
- hidden or removed
- account-level enforcement
- excluded from official totals

## Examples Needed

Allowed examples:

- TODO: Legitimate non-English skill with clear metadata and safe behavior.
- TODO: Read-only crypto portfolio or accounting helper with explicit user
  credentials and no autonomous trading.
- TODO: Defensive security audit tool with clear scope and evidence.

Not allowed examples:

- TODO: Bulk-created accounts publishing near-empty or junk skills.
- TODO: A confusing duplicate intended to impersonate a popular skill.
- TODO: Finance or trade automation that hides risk, bypasses approval, or looks
  like scam infrastructure.
- TODO: A skill that a credible public security audit identifies as malicious.

Edge cases:

- TODO: Similar names caused by forks, ports, or translations.
- TODO: Low-quality metadata on an otherwise legitimate skill.
- TODO: VirusTotal suspicious detections with no other malicious evidence.

## User Impact

- Authors should understand why a listing was hidden, excluded from discovery,
  or removed.
- Users should be able to trust official registry totals and public listings.
- Moderators should have a consistent first-pass categorization model.
- External reporters should know what kinds of evidence are useful without being
  asked to expose sensitive details.

## Open Questions

- Which categories should become public acceptable-usage rules, and which should
  stay as reviewer guidance?
- Should low-quality or non-English descriptions affect search ranking,
  installability, or only reviewer queues?
- What is the appeal or correction path for duplicate-name and low-quality
  metadata decisions?
- What evidence is enough to act on published researcher audits?
- How should we label excluded-from-total entries in reports without implying a
  moderation violation?
- Which examples should be added before opening this as a public RFC issue?
