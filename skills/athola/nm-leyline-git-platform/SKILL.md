---
name: git-platform
description: |
  Git platform detection and cross-platform command mapping for GitHub, GitLab, and Bitbucket
version: 1.8.1
triggers:
  - git
  - platform
  - github
  - gitlab
  - bitbucket
  - cross-platform
  - forge
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.authentication-patterns"]}}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Platform Detection](#platform-detection)
- [Quick Command Reference](#quick-command-reference)
- [Terminology](#terminology)
- [Integration Pattern](#integration-pattern)
- [Detailed Resources](#detailed-resources)
- [Exit Criteria](#exit-criteria)


# Git Platform Detection & Command Mapping

## Overview

Cross-platform abstraction for git forge operations. Detects whether the current project uses GitHub, GitLab, or Bitbucket, and provides equivalent CLI commands for each platform.

The SessionStart hook (`detect-git-platform.sh`) automatically injects the detected platform into session context. This skill provides the command reference for translating operations across platforms.

## When To Use

- Before running `gh`, `glab`, or forge API commands
- When a skill or command needs to create issues, PRs/MRs, or post comments
- When writing CI/CD configuration
- Any time forge-specific CLI commands appear in a workflow

## When NOT To Use

- Local-only git operations (`git commit`, `git branch`, etc.)
- Projects without a hosted git remote

## Platform Detection

Detection is automatic via the SessionStart hook. The session context will contain:

```
git_platform: github|gitlab|bitbucket, cli: gh|glab, mr_term: pull request|merge request
```

If you need to re-detect manually:

```bash
# Check remote URL
git remote get-url origin 2>/dev/null

# Check file markers
ls -d .github/ .gitlab-ci.yml bitbucket-pipelines.yml 2>/dev/null

# Check CLI availability
command -v gh && echo "GitHub CLI available"
command -v glab && echo "GitLab CLI available"
```

## Quick Command Reference

| Operation | GitHub (`gh`) | GitLab (`glab`) |
|-----------|---------------|-----------------|
| View issue | `gh issue view N --json title,body,labels` | `glab issue view N` |
| List issues | `gh issue list --json number,title` | `glab issue list` |
| Create issue | `gh issue create --title "T" --body "B"` | `glab issue create --title "T" --description "B"` |
| Close issue | `gh issue close N` | `glab issue close N` |
| Comment on issue | `gh issue comment N --body "msg"` | `glab issue note N --message "msg"` |
| View PR/MR | `gh pr view N` | `glab mr view N` |
| Create PR/MR | `gh pr create --title "T" --body "B"` | `glab mr create --title "T" --description "B"` |
| List PR/MR comments | `gh api repos/O/R/pulls/N/comments` | `glab mr note list N` |
| Current PR/MR | `gh pr view --json number` | `glab mr view --json iid` |
| Resolve threads | `gh api graphql` | `glab api graphql` |
| Repo info | `gh repo view --json owner,name` | `glab repo view` |

For Bitbucket: No standard CLI exists. Use REST API (`curl`) or the web interface. See [command-mapping module](modules/command-mapping.md) for API equivalents.

## Terminology

| Concept | GitHub | GitLab | Bitbucket |
|---------|--------|--------|-----------|
| Code review unit | Pull Request (PR) | Merge Request (MR) | Pull Request (PR) |
| CI configuration | `.github/workflows/*.yml` | `.gitlab-ci.yml` | `bitbucket-pipelines.yml` |
| Default branch | `main` | `main` | `main` |
| Review comments | PR review comments | MR discussion notes | PR comments |

**Important**: When the platform is GitLab, always say "merge request" (not "pull request") in user-facing output, commit messages, and comments.

## Integration Pattern

Skills that perform forge operations should:

1. Declare `dependencies: [leyline:git-platform]`
2. Check the session context for `git_platform:`
3. Use the command mapping table above
4. Fall back gracefully if CLI is unavailable

```markdown
# Example skill instruction pattern:

## Step N: Create PR/MR

Use the detected platform CLI (check session context for `git_platform`):
- **GitHub**: `gh pr create --title "..." --body "..."`
- **GitLab**: `glab mr create --title "..." --description "..."`
- **Bitbucket**: Create via web interface
```

## Detailed Resources

- **Full command mapping**: See [modules/command-mapping.md](modules/command-mapping.md) for complete API equivalents, GraphQL queries, and Bitbucket REST API patterns
- **Authentication**: See `Skill(leyline:authentication-patterns)` for `ensure_auth github|gitlab`

## Exit Criteria

- Platform detected (or explicitly unknown)
- Correct CLI tool used for all forge operations
- Platform-appropriate terminology in user-facing output
