---
name: git-workspace-review
description: |
  Verify workspace state, staged changes, and preflight checks before commits or PRs
version: 1.8.1
triggers:
  - git
  - preflight
  - status
  - diff
  - staged
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:shared"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Git Workspace Review

## Table of Contents

1. [Usage](#usage)
2. [Required Progress Tracking](#required-progress-tracking)

## Verification

Run `git status` after review to verify workspace state matches expectations.

## Testing

Run `pytest plugins/sanctum/tests/test_git_workspace_review.py` to validate review workflow.

## Usage

Use this skill before workflows that depend on repository state, such as commit message generation, PR preparation, or release notes. Run it once per session or whenever staged changes are modified.

## Required Progress Tracking

1. `git-review:repo-confirmed`
2. `git-review:status-overview`
3. `git-review:code-quality-check`
4. `git-review:diff-stat`
5. `git-review:diff-details`

Mark each item as complete as you finish the corresponding step.

## Step 1: Confirm Repository (`repo-confirmed`)

Run `pwd` to confirm you are in the correct repository directory. Execute `git status -sb` to view the current branch and short status, then capture the branch name and upstream information.

## Step 2: Review Status Overview (`status-overview`)

Analyze the `git status -sb` output for staged and unstaged changes. Stage or unstage files so that subsequent workflows operate on the intended diff.

## Step 3: Check Code Quality (`code-quality-check`)

Run `make format && make lint` to validate code quality before committing. Fix any errors immediately. Do not bypass pre-commit hooks with `--no-verify`. This check identifies issues early and avoids late-stage pipeline failures.

## Step 4: Review Diff Statistics (`diff-stat`)

Run `git diff --cached --stat` for staged changes (or `git diff --stat` for unstaged work). Note the number of files modified and identify hotspots with large insertion or deletion counts.

## Step 5: Review Detailed Diff (`diff-details`)

Run `git diff --cached` to examine the actual changes. For unstaged work, use `git diff`. Identify key themes, such as Makefile adjustments or new skill additions, to provide context for downstream summaries.

## Exit Criteria

Complete all progress tracking items. You should have a clear understanding of modified files and areas, and the correct work should be staged. Subsequent workflows can then rely on this context without re-executing git commands.

## Supporting Modules

- [Git commands reference](modules/git-commands.md) - diff, status, branch operations for sanctum workflows

## Troubleshooting

If pre-commit hooks block a commit, resolve the reported issues instead of using `--no-verify`. Run `make format` to fix styling errors automatically and use `make lint` to isolate logical failures. If merge conflicts occur, use `git merge --abort` to return to a clean state before retrying.
