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
gh pr view <number> --repo openclaw/clawhub --json title,body,author,labels,comments,files,commits,statusCheckRollup,reviewDecision,url,additions,deletions,changedFiles
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

## Structure PR Review Output

- Start every PR review with 1-3 plain sentences explaining what the change does
  and why it matters.
- Show size near the top as `LOC: +x/-y (N files)`, using live PR stats or
  local diff stats.
- Then list findings first. If none, say `No blocking findings` or
  `No findings`.
- Always answer: affected ClawHub surface, bug or behavior being changed,
  evidence checked, and best-fix verdict.
- For bug/regression fixes, include a compact `Provenance:` line when a bounded
  history pass identifies it. Separate code author, PR author,
  merger/committer, current PR author, PR number, and date when those differ.
  If the blamed PR was merged by automation, identify the human trigger when
  practical; otherwise say trigger unknown.

## Read Beyond The Diff

- For code-path bug, regression, or behavior changes, review the surrounding
  path, not just changed lines. Open the runtime entry point, owner module, one
  caller, one callee, adjacent tests, and sibling surfaces that should share the
  invariant.
- For docs/config/process-only changes, read the changed file, its linked or
  adjacent source of truth, and any route/workflow/template the change claims to
  affect. Do not require runtime caller/callee evidence when no runtime path
  exists.
- Compare against current `origin/main` behavior or current published docs when
  regression, compatibility, or user-visible docs accuracy matters.
- For dependency-backed behavior, read the upstream docs/source/types before
  judging API use, defaults, output shapes, errors, timeouts, memory behavior, or
  compatibility.
- Mention the main files or contracts read when the verdict depends on
  code-path, docs, config, or workflow evidence.
- If a required path is uninspected, keep reading or mark
  `Remaining uncertainty`; do not call the PR best, proof-sufficient, or
  merge-ready.

## Best-Fix Review Loop

Every PR review must explicitly answer: "Is this the best fix, or only a
plausible fix?"

Before verdict:

1. Reconstruct the bug, feature need, or behavior claim from the issue, PR, and
   proof.
2. For code-path changes, trace current behavior from entry point to failure or
   decision point.
3. For docs/config/process-only changes, trace the reader/operator workflow or
   automation path the change is meant to clarify.
4. Read touched files, relevant callers/callees for code changes, adjacent docs
   or tests, owner modules, and relevant source-of-truth docs.
5. Read sibling surfaces that should share the invariant or could be broken by a
   one-sided fix.
6. Compare against current `origin/main` and shipped behavior when relevant.
7. Identify at least one alternative fix location or shape, then reject it with
   evidence.

Review output must include:

- `Best-fix verdict:` best / acceptable mitigation / wrong layer / too narrow /
  too broad.
- `Alternatives considered:` 1-3 concrete alternatives and why rejected.
- `Code read:` compact list of main files/contracts checked.
- `Remaining uncertainty:` what was not proven.

## Enforce Bug-Fix Evidence

- Never merge a bug-fix PR based only on issue text, PR text, or AI rationale.
- Before recommending merge for a bug fix, require:
  1. symptom evidence such as a repro, logs, failing test, or focused manual
     proof
  2. a verified root cause in code with file/line
  3. blame-backed provenance for regressions when traceable, or commit SHA/date
     when no PR is traceable
  4. a fix that touches the implicated code path
  5. a regression test when feasible, or explicit manual verification plus a
     reason no test was added
- If the claim is unsubstantiated or likely wrong, request evidence or changes
  instead of recommending merge.

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
- For issue comments and PR comments containing backticks or shell characters,
  prefer a single-quoted heredoc or `--body-file` over inline `-b` bodies.
- Do not wrap issue or PR refs like `#123` in backticks when you want GitHub to
  auto-link them.
- Keep maintainer comments short: finding, evidence, requested action, and
  verification path.
- When no proof artifacts were generated, `gh pr comment --body-file` is fine.
  When proof artifacts were generated, use `proof:publish` so screenshots/videos
  are published before posting.
- Do not close more than five issues/PRs in one action without explicit
  confirmation and the exact target list.
