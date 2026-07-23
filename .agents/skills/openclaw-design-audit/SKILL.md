---
name: openclaw-design-audit
description: Audit OpenClaw frontend code and rendered interfaces for Carapace drift, token misuse, primitive reimplementation, accessibility problems, responsive defects, and off-brand copy. Use for design reviews, compliance checks, or scheduled audit-and-fix workflows.
---

# OpenClaw Design Audit

Separate mechanical violations from judgment. Report suggestions as suggestions
unless a documented rule makes them violations.

## Workflow

1. Read [rubric.md](references/rubric.md) and run every applicable category.
2. Read the consumer's installed Carapace version and current commit SHA.
3. Read the version-matched token contract and consumer adapters from the
   installed product guidance skill: `openclaw-carapace` for new installs or
   the `openclaw-design-system` compatibility alias for an upgraded lock.
4. Read the brand or marketing references when those categories apply.
5. Run deterministic source checks before judgment-based review.
6. Inspect representative rendered routes at desktop and mobile sizes.
7. Check light and dark themes where supported.
8. Emit the JSON and Markdown defined in [report-format.md](references/report-format.md).
9. When asked to fix findings, apply only narrow changes allowed by [fix-policy.md](references/fix-policy.md).
10. For scheduled ClawHub delivery, follow [github-pr-delivery.md](references/github-pr-delivery.md).

## Evidence

Each finding must include:

- file and line
- category and severity
- stable rule ID
- concise remediation
- Carapace reference
- whether the finding is mechanical or judgment-based

## Curation

- Include every error.
- Rank warnings before informational findings, then by affected-file count.
- Surface at most five non-error findings in the concise report.
- Summarize remaining non-error findings by count.
- Treat zero errors, zero warnings, and five or fewer informational findings as
  no significant drift.
- Never invent source locations or visual evidence.
