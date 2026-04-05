---
name: commit-messages
description: |
  'Generate conventional commit messages from staged changes with correct type/scope
version: 1.8.1
triggers:
  - git
  - commit
  - conventional-commits
  - generating commit messages in conventional commits format
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Conventional Commit Workflow

## When To Use

- Generating conventional commit messages from staged changes

## When NOT To Use

- Full PR preparation: use sanctum:pr-prep
- Amending existing commits: use git directly

## Steps

1. **Gather context** (run in parallel):
   - `git status -sb`
   - `git diff --cached --stat`
   - `git diff --cached`
   - `git log --oneline -5`

   If nothing is staged, tell the user and stop.

2. **Classify**: Pick type (`feat`, `fix`, `docs`, `refactor`,
   `test`, `chore`, `style`, `perf`, `ci`) and optional scope.

3. **Draft the message**:
   - **Subject**: `<type>(<scope>): <imperative summary>` (50 chars max)
   - **Body**: What and why, wrapped at 72 chars
   - **Footer**: BREAKING CHANGE or issue refs

4. **Slop check**: reject these words and replace with plain
   alternatives:

   | Reject | Use instead |
   |--------|-------------|
   | leverage, utilize | use |
   | seamless | smooth |
   | comprehensive | complete |
   | robust | solid |
   | facilitate | enable |
   | streamline | simplify |
   | optimize | improve |
   | delve | explore |
   | multifaceted | varied |
   | pivotal | key |
   | intricate | detailed |

   Also reject: "it's worth noting", "at its core",
   "in essence", "a testament to"

5. **Write** to `./commit_msg.txt` and preview.

## Rules

- NEVER use `git commit --no-verify` or `-n`
- Write for humans, not to impress
- If pre-commit hooks fail, fix the issues
