---
parent_skill: sanctum:shared
name: git-commands
description: Common git commands used across sanctum workflows
category: patterns
tags: [git, commands, diff, status]
estimated_tokens: 200
---

# Git Commands for Sanctum Workflows

## Repository Confirmation

### Verify Working Directory
```bash
pwd
```
validates you are in the correct repository before running git operations.

### Check Branch and Status
```bash
git status -sb
```
Shows current branch, upstream tracking, and short status in one line.

## Diff Commands

### Staged Changes Statistics
```bash
git diff --cached --stat
```
Shows file-by-file statistics for staged changes (insertions/deletions).

### Staged Changes Details
```bash
git diff --cached
```
Full diff of staged changes for review before commit.

### Unstaged Changes Statistics
```bash
git diff --stat
```
File-by-file statistics for unstaged working directory changes.

### Unstaged Changes Details
```bash
git diff
```
Full diff of unstaged working directory changes.

### Branch Comparison Statistics
```bash
git diff --stat origin/main...HEAD
```
Shows statistics for all commits in current branch since diverging from main.

### Branch Comparison Details
```bash
git diff origin/main...HEAD
```
Full diff of all changes in current branch compared to main.

## Status Parsing Patterns

### Extract Branch Name
From `git status -sb` output, the first line shows:
```
## branch-name...origin/branch-name [ahead N, behind M]
```

Parse the branch name from the `##` line.

### Identify Staged vs Unstaged
- Lines starting with `M ` (M-space): staged modification
- Lines starting with ` M` (space-M): unstaged modification
- Lines starting with `A ` (A-space): staged new file
- Lines starting with `??`: untracked file

### Count Changes
Use `--stat` output to count affected files:
```
 file1.md | 10 +++++++---
 file2.py | 5 +++++
 2 files changed, 12 insertions(+), 3 deletions(-)
```

## Branch Operations

### Get Merge Base
```bash
git merge-base origin/main HEAD
```
Finds the common ancestor commit for comparison.

### List Recent Commits
```bash
git log --oneline -10
```
Shows last 10 commits in compact format.

### Show Commit Details
```bash
git show <commit-hash>
```
Displays commit message and diff for a specific commit.

## Best Practices

### Always Run in Sequence
1. `pwd` - Confirm location
2. `git status -sb` - Check branch/status
3. `git diff --cached --stat` - Review staged stats
4. `git diff --cached` - Review staged details

### Use Limits
- Always limit `git log` output (e.g., `-10`, `-20`)
- Use `--stat` before full diffs to understand scope
- For large diffs, consider `git diff --cached -- <specific-file>`

### Error Handling
- Check if `git status` shows "Not a git repository"
- Verify upstream tracking exists before comparing to origin
- Handle empty diffs (no staged changes) gracefully
