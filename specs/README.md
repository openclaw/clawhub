# Specs

`specs/` holds maintainer-only or non-navigated records that should not publish
to the public ClawHub docs tab by default.

Use this folder for:

- Product and implementation specs.
- Forward-looking plans and migration notes.
- Regression notes and design history.
- Maintainer validation or CI policy records.
- Cross-repo extraction notes that reviewers need but users do not.

Public/user/operator docs belong in `docs/`. If a spec graduates into something
users should read on `docs.openclaw.ai`, move or summarize the public material
into `docs/` and leave only the design record here.

## Index

- `spec.md`: product + implementation spec for the original registry model.
- `orgs.md`: org, publisher membership, and scoped identity plan.
- `github-import.md`: GitHub import feature spec.
- `diffing.md`: skill version diffing UI/API design.
- `slug-routing.md`: internal web route precedence and plugin alias contract.
- `ci.md`: PR check and production deploy audit-tag policy.
- `manual-testing.md`: maintainer CLI smoke checklist.
- `dev-worktrees.md`: disposable Worktrunk/Codex worktree lifecycle contract.
- `dev-seeding.md`: local development fixture seeding ownership rules.
- `mintlify.md`: docs publishing setup notes.
- `openclaw-docs-extraction.md`: CLAW-89 extraction classification.
- `deploy.md`: maintainer deploy checklist for the ClawHub project.
- `security-moderation.md`: detailed moderation implementation and scanner behavior notes.
- `webhook.md`: Discord webhook environment and payload notes.
- `plans/plugins.md`: long-term OpenClaw plugin hosting plan.
- `regression-notes/`: regression guard notes.
- `superpowers/`: install-surface design history.
