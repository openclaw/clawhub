---
name: quality-gate
description: |
  Orchestrates egregore's QUALITY pipeline stage. Runs convention checks and invokes review skills for each quality step. Supports self-review (pre-PR) and PR-review (other agents' PRs) modes
version: 1.8.1
triggers:
  - egregore
  - quality
  - review
  - conventions
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/egregore", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: egregore
---

> **Night Market Skill** — ported from [claude-night-market/egregore](https://github.com/athola/claude-night-market/tree/master/plugins/egregore). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Quality Gate

## When To Use

- Running quality checks on egregore work items
- Self-review before creating a PR
- Reviewing another agent's PR in PR-review mode

## When NOT To Use

- Manual code reviews outside egregore pipeline
- One-off lint or format checks (use `make lint` directly)

Orchestrate the QUALITY stage of egregore's pipeline.
Each quality step runs convention checks from the codex
and invokes mapped skills.

## Routing Table

| Step | Conventions | Skills | Modes |
|------|------------|--------|-------|
| code-review | C1,C2,C3,C4,C5 | pensive:unified-review | self, pr |
| unbloat | - | conserve:unbloat | self |
| code-refinement | - | pensive:code-refinement | self |
| update-tests | - | sanctum:update-tests | self |
| update-docs | C5 | sanctum:update-docs, scribe:slop-detector | self |

## Inputs

The orchestrator invokes this skill with:

- **step**: which quality step to run (e.g. "code-review")
- **mode**: "self-review" or "pr-review"
- **work_item_id**: the manifest work item ID
- **branch**: the git branch with changes
- **pr_number**: (PR-review mode only) the PR number

## Self-Review Workflow

When mode is "self-review":

1. Get changed files: `git diff --name-only main...HEAD`
2. Load conventions from `conventions/codex.yml`
3. Filter conventions to those mapped to the current step
4. Run convention checks via `conventions.py`
5. Invoke mapped skills on the changed files
6. Collect all findings
7. Calculate verdict

### Auto-Fix Loop

If blocking findings exist:

1. Attempt to fix each finding (skill-dependent)
2. Commit fixes to the work item branch
3. Re-run convention checks
4. If still blocking after 3 attempts, verdict is
   "fix-required"

### Verdict Calculation

```
if no findings:
    verdict = "pass"
elif all findings are severity "warning":
    verdict = "pass-with-warnings"
elif blocking findings remain after auto-fix:
    verdict = "fix-required"
```

Record verdict in manifest decisions:

```json
{
  "step": "code-review",
  "chose": "pass-with-warnings",
  "why": "2 warnings (C4: noqa in hooks), 0 blocking"
}
```

## PR-Review Workflow

When mode is "pr-review":

1. Fetch PR diff: `gh pr diff <number> --name-only`
2. Load conventions and filter to code-review step
3. Run convention checks on changed files
4. Invoke `pensive:unified-review` on the diff
5. Collect all findings

### Posting Reviews

Map findings to GitHub review:

- **No findings**: `gh api` POST review with
  event "APPROVE"
- **Warnings only**: POST review with event "COMMENT",
  findings as inline comments
- **Blocking findings**: POST review with event
  "REQUEST_CHANGES", blocking findings as inline
  comments with "must fix" prefix

Comment format per finding:

```
[egregore:{convention_id}] {message}

Convention: {convention_name}
Severity: {severity}
```

## Quality Config

Work items may have a `quality_config` field:

```json
{
  "skip": ["unbloat"],
  "only": ["code-review", "update-docs"]
}
```

- `skip`: list of steps to skip (run all others)
- `only`: list of steps to run (skip all others)
- If both are set, `only` takes precedence
- If neither is set, all steps run (default)

## Convention Filtering by Step

Not all conventions run on every step. The routing
table above defines which conventions apply to which
step. The quality gate filters the loaded codex
accordingly before running checks.

## Exit Criteria

- All applicable convention checks executed
- All mapped skills invoked
- Verdict calculated and recorded in manifest
- For PR-review: GitHub review posted
