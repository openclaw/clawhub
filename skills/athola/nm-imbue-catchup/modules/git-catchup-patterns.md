---
name: git-catchup-patterns
description: Git-specific commands and patterns for catchup analysis
parent_skill: imbue:catchup
category: technical-patterns
tags: [git, version-control, delta-capture]
estimated_tokens: 400
---

# Git Catchup Patterns

## Git Context Establishment

Use these commands to establish git repository context:

```bash
pwd                                                 # Show current directory
git status -sb | head -n 1                          # Show current branch and status
git rev-parse --abbrev-ref --symbolic-full-name @{u}  # Show the upstream branch, if one is being tracked
```

These help answer:
- Where am I working?
- What branch am I on?
- Is this branch tracking a remote?

## Git Delta Capture

Efficiently capture changes between states:

```bash
git diff --stat ${BASE}...HEAD                      # Show summary statistics
git diff --name-only ${BASE}...HEAD                 # List changed files
git log --oneline ${BASE}...HEAD                    # Show commit history
```

**Key Patterns:**
- Use `--stat` for high-level overview (files changed, insertions/deletions)
- Use `--name-only` for enumeration without content
- Use `...` three-dot syntax to show changes on current branch since divergence

## Git-Specific Insights Extraction

Targeted inspection commands:

```bash
git show --stat <commit>                            # Show specific commit changes
git diff ${BASE}...HEAD -- path/to/file             # Examine specific file changes
git log -p --follow -- path/to/file                 # File history with patches
```

**Efficient Reading:**
- Use `git show` for commit-level understanding
- Use `git diff` with file paths for focused analysis
- Avoid `git log -p` without limits (token-heavy)

## Integration with Sanctum

**Before running catchup analysis**, use `sanctum:git-workspace-review` to gather:
- Repository confirmation (pwd, branch)
- Status overview (staged vs unstaged)
- Diff statistics
- Diff details

Then proceed with catchup-specific insight extraction and follow-up identification.

**Sanctum provides the raw data; catchup extracts insights and actionable items.**

## Common Patterns

**Feature Branch Catchup:**
```bash
BASE=$(git merge-base main HEAD)
git diff --stat main...HEAD
git log --oneline main...HEAD
```

**Release Catchup:**
```bash
git diff --stat v1.0.0...v1.1.0
git log --oneline --graph v1.0.0...v1.1.0
```

**Daily Standup Catchup:**
```bash
git log --since="yesterday" --oneline --all
git diff --stat HEAD@{yesterday}...HEAD
```
