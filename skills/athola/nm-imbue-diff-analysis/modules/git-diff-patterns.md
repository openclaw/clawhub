---
name: git-diff-patterns
description: Git-specific commands and patterns for diff analysis
parent_skill: imbue:diff-analysis
category: tool-integration
tags: [git, diff, baseline, integration]
estimated_tokens: 200
---

# Git Diff Patterns

## Baseline Establishment

Define comparison scope in git repositories:

```bash
# Show latest commit for context
git log --oneline -1 HEAD

# Find common ancestor between branches
git merge-base HEAD main

# Show summary of changes between baseline and HEAD
git diff --stat <baseline>..HEAD | tail -1

# Count changed files
git diff --name-only <baseline>..HEAD | wc -l
```

## Change Type Isolation

Use `--diff-filter` to focus on specific change categories:

```bash
git diff --name-only --diff-filter=A <baseline>  # Additions
git diff --name-only --diff-filter=M <baseline>  # Modifications
git diff --name-only --diff-filter=D <baseline>  # Deletions
git diff --name-only --diff-filter=R <baseline>  # Renames
```

## Integration with Sanctum

Before running diff analysis on git repositories, use `sanctum:git-workspace-review` to gather repository context:

- Repository confirmation (pwd, branch)
- Status overview (staged vs unstaged)
- Diff statistics
- Diff details

Then proceed with imbue-specific semantic analysis and risk assessment.

## Usage Pattern

1. **Sanctum First**: Use `sanctum:git-workspace-review` to gather raw git data
2. **Imbue Second**: Apply semantic categorization and risk assessment to findings
3. **Evidence**: Use `imbue:proof-of-work` to capture analysis artifacts
4. **Output**: Format with `imbue:structured-output` for downstream consumption
