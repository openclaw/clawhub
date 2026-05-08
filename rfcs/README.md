# RFC Process

An RFC is the feedback funnel for a decision. The accepted docs, code, or issue comments become the source of truth after the RFC is resolved.

This folder is intentionally outside `docs/` so RFC drafts and decision records do not publish to the docs site.

## When to use an RFC

Use an RFC for changes that should be understood before they ship:

- moderation and acceptable-usage policy
- security, trust, or appeal workflows
- public API or CLI contracts
- user-visible product behavior
- decisions that need external contributor feedback

Do not use an RFC for small bug fixes, routine docs edits, private incident handling, or internal-only reviewer tactics.

## Public vs private scope

Public RFCs should include the user-facing decision, goals, examples, open questions, and expected impact.

Keep these out of public RFCs:

- private reports, reporter identities, or user-specific enforcement details
- exploit instructions or abuse-enabling implementation detail
- exact scanner thresholds, evasion indicators, or vendor-private signals
- reviewer-only operational playbooks

If private context changes the outcome, summarize the principle in a maintainer comment without exposing sensitive details.

## Lifecycle

1. Draft the shape internally when the topic is sensitive or ambiguous.
2. Open a GitHub issue with the RFC template.
3. Keep normal RFCs open for 7-14 days. Use shorter windows only for urgent trust or safety decisions.
4. A maintainer posts a synthesis comment covering major feedback, accepted changes, rejected changes, and remaining risks.
5. Close the RFC as accepted, declined, withdrawn, or superseded.
6. Land the accepted result in docs or code through a linked PR.

## Labels

Create these labels in GitHub if they do not already exist:

```sh
gh label create "type: rfc" --repo openclaw/clawhub --color "5319E7" --description "Request for comments on a product, policy, trust, or interface decision"
gh label create "status: review" --repo openclaw/clawhub --color "FBCA04" --description "Open for maintainer/community feedback"
gh label create "status: accepted" --repo openclaw/clawhub --color "0E8A16" --description "Decision accepted; implementation or docs follow-up expected"
gh label create "status: declined" --repo openclaw/clawhub --color "D93F0B" --description "Decision declined after review"
gh label create "status: withdrawn" --repo openclaw/clawhub --color "C5DEF5" --description "Closed by the proposer before acceptance or decline"
gh label create "status: superseded" --repo openclaw/clawhub --color "BFDADC" --description "Replaced by a newer RFC, issue, or PR"
gh label create "area: moderation" --repo openclaw/clawhub --color "C2E0C6" --description "Moderation, acceptable usage, reporting, appeals, or enforcement"
gh label create "area: security" --repo openclaw/clawhub --color "D4C5F9" --description "Security, abuse prevention, or trust and safety"
```

## Moderation RFCs

For moderation guidelines:

- public policy belongs in `docs/acceptable-usage.md`
- moderator and system mechanics belong in `docs/security.md`
- API or CLI changes belong in `docs/http-api.md` and `docs/cli.md`
- implementation details should link to the RFC and final docs in the PR summary

Good moderation RFCs include concrete allowed, not allowed, and edge-case examples. They should explain user-visible enforcement and appeals without exposing detection thresholds or private review tactics.
