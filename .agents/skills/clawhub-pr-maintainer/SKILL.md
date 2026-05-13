---
name: clawhub-pr-maintainer
description: Use when reviewing, triaging, validating, or discussing ClawHub GitHub issues or pull requests, including author context, CI, UI proof, evidence, labels, close decisions, and maintainer handoff.
---

# ClawHub PR Maintainer

Use this skill for maintainer-facing ClawHub GitHub workflow, not for ordinary
implementation work.

## Start With Live GitHub State

- Use `gh pr view` or `gh issue view` against `openclaw/clawhub`; verify live
  state before commenting, labeling, closing, or recommending merge.
- For PRs, read title, body, author, labels, comments, files, commits, status
  checks, review state, and linked issues.
- Surface author identity briefly: GitHub name/login and account age when
  useful. Treat identity as triage signal, never as proof by itself.

Common read-only commands:

```sh
gh pr view <number> --repo openclaw/clawhub --json title,body,author,labels,comments,files,commits,statusCheckRollup,reviewDecision,url
gh issue view <number> --repo openclaw/clawhub --json title,body,author,labels,comments,state,url
gh api users/<login> --jq '{login,name,created_at,type}'
```

## Review Evidence Bar

- For bug fixes, require symptom evidence, a plausible root cause in the touched
  code path, and either a regression test or focused manual proof.
- For UI changes, require screenshots or video when the behavior is meaningfully
  visual. Use tests as supplemental evidence, not a substitute for visible proof.
- Do not merge or recommend merge based only on PR prose, AI rationale, or green
  CI when the changed behavior has not been exercised.
- For contributor-provided screenshots/videos/logs, inspect the artifact
  directly and state what it proves. Do not rerun `proof:ui` just to inspect
  existing evidence.

## Decide UI Proof Mode

Use the `clawhub-ui-proof` skill when the maintainer/agent should generate new
visual evidence.

- `before-after`: bug fixes, regressions, changed copy, changed layout, or any
  PR where main-vs-candidate comparison clarifies the change.
- `feature`: new page, new flow, new UI state, or behavior that cannot exist on
  `origin/main`.
- No generated proof: docs-only, backend-only, tests-only, metadata-only, or
  already-sufficient contributor evidence.

Write a temporary Playwright scenario under `.artifacts/proof-scenarios/`; do
not infer manual clicks. Keep screenshots and videos in `.artifacts/` until
publishing. Never commit proof artifacts.

## Final Review Comment With Proof

If this review generated `proof:ui` artifacts, publish them before the final PR
review comment. Do not leave only local `.artifacts/...` paths in a PR comment;
they are useful to the maintainer locally but invisible to GitHub readers.

Use:

```sh
bun run proof:publish -- --proof-dir .artifacts/clawhub-ui-proof/<timestamp> --target-pr <number>
```

`proof:publish` copies the selected files to the `qa-artifacts` branch and
upserts a marker-backed PR comment with a **ClawHub UI Proof** section.

That comment includes:

- the proof mode (`before-after` or `feature`)
- the `report.md` result summary
- the most relevant per-step screenshots
- inline video previews when GIF previews are present
- links to full-run MP4s
- links to raw proof files on the artifact branch

Use `--dry-run` before publishing if you need to inspect the generated comment.
If publishing fails because credentials are missing, report the local proof
directory and the failed command instead of posting a comment that claims
evidence is attached.

## ClawSweeper

ClawSweeper is the bot control plane for automated PR/issue review once ClawHub
dispatch is configured. Until then, use this skill for manual maintainer review.
If ClawSweeper has posted a review, read it as evidence but verify live PR state
before acting.

## Commenting And Labels

- Use literal multiline comment bodies or `--body-file`; never pass escaped
  `\n` strings.
- Keep maintainer comments short: finding, evidence, requested action, and
  verification path.
- When no proof artifacts were generated, `gh pr comment --body-file` is fine.
  When proof artifacts were generated, use `proof:publish` so screenshots/videos
  are published before posting.
- Do not close more than five issues/PRs in one action without explicit
  confirmation and the exact target list.
