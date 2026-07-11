# GitHub Pull Request Delivery

The scheduled ClawHub audit opens a pull request directly against
`openclaw/clawhub`. It does not create or update a tracker issue.

The schedule and credentials live in the consumer repository's GitHub Actions
workflow. This design-system skill defines the audit and delivery contract; it
does not schedule itself.

## Branch And Scope

- Use a stable automation branch such as `automation/design-audit`.
- Start from current remote `main`.
- Commit only the report and allowed deterministic fixes.
- Do not overwrite unrelated human work on an existing branch.

## Procedure

1. Checkout `openclaw/clawhub` with full history and fetch remote `main`.
2. Reset only the dedicated automation branch to `origin/main`.
3. Install the design system at the workflow's pinned Git tag.
4. Run source checks, browser checks, and report generation.
5. Apply only fixes allowed by `fix-policy.md`.
6. Write reports under the consumer's established audit-artifact path.
7. If the decision table says `artifact only`, upload the reports and job
   summary without pushing a branch.
8. Otherwise commit, force-push the dedicated automation branch with
   `--force-with-lease`, then use `gh pr create` or `gh pr edit` for the single
   open pull request owned by that branch.

## Pull Request

The title must identify the audit and date. The body includes:

- design-system version
- audited ClawHub SHA
- count by severity
- commands and routes checked
- concise expanded findings
- whether fixes are included
- paths to JSON, Markdown, and screenshot artifacts

If an open audit pull request exists, update it only when it owns the same stable
automation branch. Close it without merge when a later clean run makes its
findings obsolete.

## Decision Table

| Findings | Delivery |
| --- | --- |
| One or more errors | Open or update the pull request |
| Zero errors and one or more warnings | Open or update the pull request |
| Zero errors, zero warnings, more than five informational findings | Open or update the pull request |
| Zero errors, zero warnings, five or fewer informational findings | Artifact and job summary only |
| No findings | Artifact and job summary only; close an obsolete open audit PR |
