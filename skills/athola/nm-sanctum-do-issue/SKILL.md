---
name: do-issue
description: |
  Parallel subagent execution with code review gates between task batches for issue resolution
version: 1.8.1
triggers:
  - github
  - gitlab
  - issues
  - subagents
  - parallel
  - automation
  - cross-platform
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\u2699\ufe0f", "requires": {"config": ["night-market.leyline:git-platform", "night-market.superpowers:subagent-driven-development", "night-market.superpowers:writing-plans", "night-market.superpowers:test-driven-development", "night-market.superpowers:requesting-code-review", "night-market.superpowers:finishing-a-development-branch"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Key Features](#key-features)
- [Workflow Overview](#workflow-overview)
- [Required TodoWrite Items](#required-todowrite-items)
- [Configuration](#configuration)
- [Detailed Resources](#detailed-resources)


# Fix Issue(s)

Retrieves issue content from the detected git platform (GitHub, GitLab, or Bitbucket) and uses subagent-driven-development to systematically address requirements, executing tasks in parallel where dependencies allow.

**Platform detection is automatic** via the `leyline:git-platform` SessionStart hook. Check session context for `git_platform:` to determine which CLI to use.

## Key Features

- **Cross-Platform**: Automatically detects GitHub/GitLab/Bitbucket and uses appropriate CLI
- **Flexible Input**: Single issue number, platform URL, or space-delimited list
- **Parallel Execution**: Independent tasks run concurrently via subagents
- **One PR**: All issues produce one consolidated PR (never per-issue PRs)
- **Quality Gates**: Code review between task groups
- **Fresh Context**: Each subagent starts with clean context for focused work

## Workflow Overview

| Phase | Description | Module |
|-------|-------------|--------|
| 1. Discovery | Parse input, fetch issues, extract requirements | [issue-discovery](modules/issue-discovery.md) |
| 2. Planning | Analyze dependencies, create task breakdown | [task-planning](modules/task-planning.md) |
| 3. Execution | Dispatch parallel subagents for independent tasks | [parallel-execution](modules/parallel-execution.md) |
| 4. Quality | Code review gates between task batches | [quality-gates](modules/quality-gates.md) |
| 5-6. Completion | Sequential tasks, final review, issue updates | [completion](modules/completion.md) |

## Required TodoWrite Items

1. `do-issue:discovery-complete`
2. `do-issue:tasks-planned`
3. `do-issue:parallel-batch-complete`
4. `do-issue:review-passed`
5. `do-issue:sequential-complete`
6. `do-issue:issues-updated`

## Forge CLI Commands

Use the platform detected in session context (`git_platform:`). See `Skill(leyline:git-platform)` for full mapping.

| Operation | GitHub (`gh`) | GitLab (`glab`) |
|-----------|---------------|-----------------|
| Fetch issue | `gh issue view <N> --json title,body,labels,comments` | `glab issue view <N>` |
| Comment | `gh issue comment <N> --body "msg"` | `glab issue note <N> --message "msg"` |
| Close | `gh issue close <N> --comment "reason"` | `glab issue close <N>` |
| Search | `gh issue list --search "query"` | `glab issue list --search "query"` |

**Verification:** Run the command with `--help` flag to verify availability.

## Agent Teams (Default Execution Mode)

Agent teams is the **default** parallel execution backend for do-issue. Teammates coordinate via filesystem-based messaging, enabling real-time communication when shared files or dependencies are discovered mid-implementation.

**Automatic downgrade**: For single issues with `--scope minor`, agent teams is skipped (Task tool or inline execution is used instead). Use `--no-agent-teams` to force Task tool dispatch for any invocation.

**Requires**: Claude Code 2.1.32+, tmux, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. If prerequisites are missing, silently falls back to Task tool dispatch.

```yaml
# Agent teams configuration
fix_issue:
  agent_teams:
    enabled: true           # on by default; --no-agent-teams to disable
    max_teammates: 4        # limit concurrent workers
    model: sonnet           # teammate model (lead uses current model)
    auto_downgrade: true    # skip agent teams for --scope minor
```

See `modules/parallel-execution.md` for detailed agent teams patterns.

## Configuration

```yaml
fix_issue:
  parallel_execution: true
  max_parallel_subagents: 3
  review_between_batches: true
  auto_close_issues: false
  commit_per_task: true
```
**Verification:** Run the command with `--help` flag to verify availability.

## Detailed Resources

- **Phase 1**: See [modules/issue-discovery.md](modules/issue-discovery.md) for input parsing and requirement extraction
- **Phase 2**: See [modules/task-planning.md](modules/task-planning.md) for dependency analysis
- **Phase 3**: See [modules/parallel-execution.md](modules/parallel-execution.md) for subagent dispatch
- **Phase 4**: See [modules/quality-gates.md](modules/quality-gates.md) for review patterns
- **Phase 5-6**: See [modules/completion.md](modules/completion.md) for finalization
- **Errors**: See [modules/troubleshooting.md](modules/troubleshooting.md) for common issues
