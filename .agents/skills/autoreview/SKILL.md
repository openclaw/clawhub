---
name: autoreview
description: "Use when ClawHub needs Codex review, autoreview, second-model review, or a final advisory review gate before commit, PR update, ship, or maintainer handoff."
---

# Autoreview

Run Codex's built-in code review as a closeout check. This is code review
(`codex review`), not Guardian `auto_review` approval routing.

Codex native review mode performs best and is recommended. Non-Codex reviewers
are fallback or second-opinion paths that receive a generated diff prompt, not
the full Codex review-mode runtime.

Use when:

- the user asks for Codex review, autoreview, or second-model review
- after non-trivial code edits, before final/commit/ship
- reviewing a local branch or PR branch after fixes
- closing out ClawHub maintainer work that touched source, tests, Convex, UI,
  CLI packages, or workflows

## Contract

- Treat review output as advisory. Never blindly apply it.
- Verify every finding by reading the real code path and adjacent files.
- Read dependency docs/source/types when the finding depends on external
  behavior.
- Reject unrealistic edge cases, speculative risks, broad rewrites, and fixes
  that over-complicate the codebase.
- Prefer small fixes at the right ownership boundary; no refactor unless it
  clearly improves the bug class.
- Keep going until the selected review path returns no accepted/actionable
  findings.
- If a review-triggered fix changes code, rerun focused tests and rerun the
  review helper.
- Default to Codex review. If Codex is unavailable or exits with an error, the
  helper can fall back to `claude -p`, `pi -p`, `opencode run`, `droid exec`, or
  `copilot`.
- Stop as soon as the review command/helper exits 0 with no
  accepted/actionable findings. Do not run an extra direct `codex review` just
  to get a nicer clean line, a second opinion, or clearer closeout wording.
- If rejecting a finding as intentional/not worth fixing, add a brief inline
  code comment only when it explains a real invariant or ownership decision
  future reviewers should know.
- Do not push just to review. Push only when the user requested push/ship/PR
  update.

## ClawHub Proof Routing

Pick the smallest proof that matches the touched surface:

| Touched surface | Usual proof |
| --- | --- |
| Formatting/lint/static repo health | `bun run ci:static` |
| Unit-tested source behavior | focused `bunx vitest run ...`, then `bun run ci:unit` when PR-ready |
| Convex code | read `convex/_generated/ai/guidelines.md` first; run focused tests and the deploy/typecheck path that covers the change |
| Packages/CLI/mod tool | `bun run ci:packages` or the package-specific `verify` script |
| Runtime/build/package surface | `bun run ci:types-build`, `bun run ci:e2e-http`, or the matching broader gate |
| UI behavior | use `clawhub-ui-proof` with `proof:ui`; publish proof before final PR comments when needed |
| Linux/CI-parity validation | use `crabbox`, normally through the repo scripts |

For Convex query or schema work, apply the repo's Convex rules: prefer indexes
over `.filter()` scans, use cursor-based backfills for data shape changes, and
verify with the repo's Convex/typecheck path before claiming deploy safety.

## Pick Target

Dirty local work:

```bash
codex review --uncommitted
```

Use this only when the patch is actually unstaged/staged/untracked in the
current checkout. For committed, pushed, or PR work, point Codex at the commit
or branch diff instead. A clean `--uncommitted` review only proves there is no
local patch.

Branch/PR work:

```bash
git fetch origin
codex review --base origin/main
```

If an open PR exists, use its actual base:

```bash
base=$(gh pr view --json baseRefName --jq .baseRefName)
codex review --base "origin/$base"
```

Do not pass a prompt with `--base`. Some Codex CLI versions reject
`codex review --base <ref> -` with `--base <BRANCH> cannot be used with
[PROMPT]`. If that happens, rerun plain `codex review --base <ref>` and report
that prompt injection was skipped.

Committed single change:

```bash
codex review --commit HEAD
```

or with the helper:

```bash
.agents/skills/autoreview/scripts/autoreview --mode commit --commit HEAD
```

Use commit review for already-landed or already-pushed work on `main`.
Reviewing clean `main` against `origin/main` is usually an empty diff after
push. For a small stack, review each commit explicitly or review the branch
before merging with `--base`.

## Parallel Closeout

Format first if formatting can change line locations. Then it is OK to run
tests and review in parallel:

```bash
.agents/skills/autoreview/scripts/autoreview --parallel-tests "bun run ci:static"
```

Tradeoff: tests may force code changes that stale the review. If tests or
review lead to code edits, rerun the affected tests and rerun review until no
accepted/actionable findings remain. Once that rerun exits cleanly, stop; do
not spend another long review cycle on redundant confirmation.

## Context Efficiency

Codex review is usually noisy. Default to a subagent filter when subagents are
available. Ask it to run the review and return only:

- actionable findings it accepts
- findings it rejects, with one-line reason
- exact files/tests to rerun

Run inline only for tiny changes or when subagents are unavailable.

## Helper

Bundled helper:

```bash
.agents/skills/autoreview/scripts/autoreview --help
```

The helper:

- chooses dirty `--uncommitted` first
- otherwise uses current PR base if `gh pr view` works
- otherwise uses `origin/main` for non-main branches
- auto-runs `bun run ci:static` in parallel when the repo has `package.json`,
  `bun.lock`, `node_modules`, and a `ci:static` script; disable with
  `AUTOREVIEW_AUTO_TESTS=0`
- use `--mode commit --commit <ref>` for already-committed work, especially
  clean `main` after landing
- should be left in `--mode auto` or forced to `--mode branch` for PR/branch
  work; do not force `--mode local` after committing
- supports `--reviewer codex|claude|pi|opencode|droid|copilot|auto`; `auto`
  means Codex first
- supports `--fallback-reviewer auto|claude|pi|opencode|droid|copilot|none`
- falls back only when Codex is unavailable or exits nonzero without findings,
  not when Codex reports findings
- writes only to stdout unless `--output` or `AUTOREVIEW_OUTPUT` is set
- supports `--dry-run`, `--parallel-tests`, and commit refs
- runs nested review with `--dangerously-bypass-approvals-and-sandbox --sandbox
  danger-full-access` by default; use `--no-yolo` or `AUTOREVIEW_YOLO=0` to opt
  out
- prints `autoreview clean: no accepted/actionable findings reported` when the
  selected review command exits 0 and no accepted/actionable findings are
  reported

## Final Report

Include:

- review command used
- tests/proof run
- findings accepted/rejected, briefly why
- the clean review result from the final helper/review run, or why a remaining
  finding was consciously rejected

Do not run another Codex review solely to improve final wording. If the final
helper run exited 0 and produced no accepted/actionable findings, report that
exact run as clean.

## PR / CI Closeout

- Prefer direct run/job APIs after CI starts: `gh run view <run-id> --json jobs`;
  use PR rollup only for final mergeability.
- After rebase, compare `origin/main..HEAD`; drop CI-fix commits already
  upstream before pushing.
- Update the PR body once near the final head unless proof labels are missing
  or stale enough to block CI.
