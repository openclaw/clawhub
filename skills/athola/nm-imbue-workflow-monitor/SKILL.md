---
name: workflow-monitor
description: |
  Detect workflow failures and inefficient patterns, then create GitHub issues for improvement via /fix-workflow
version: 1.8.1
triggers:
  - workflow
  - monitoring
  - error-detection
  - efficiency
  - automation
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/imbue", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.leyline:git-platform", "night-market.imbue:proof-of-work", "night-market.sanctum:fix-workflow"]}}}
source: claude-night-market
source_plugin: imbue
---

> **Night Market Skill** — ported from [claude-night-market/imbue](https://github.com/athola/claude-night-market/tree/master/plugins/imbue). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Philosophy](#philosophy)
- [Quick Start](#quick-start)
- [Detection Patterns](#detection-patterns)
- [Workflow](#workflow)
- [Issue Template](#issue-template)
- [Configuration](#configuration)
- [Guardrails](#guardrails)
- [Integration Points](#integration-points)
- [Output Format](#output-format)

# Workflow Monitor

Monitor workflow executions for errors and inefficiencies, automatically creating issues on the detected git platform (GitHub/GitLab) for improvements. Check session context for `git_platform:` and use `Skill(leyline:git-platform)` for CLI command mapping.

## Philosophy

Workflows should improve over time. When execution issues occur, capturing them systematically enables continuous improvement. This skill hooks into workflow execution to detect problems and propose fixes.

## Quick Start

### Manual Invocation

```bash
# After a failed workflow
/workflow-monitor --analyze-last

# Monitor a specific workflow execution
/workflow-monitor --session <session-id>

# Analyze efficiency of recent workflows
/workflow-monitor --efficiency-report
```

### Automatic Monitoring (via hooks)

When enabled, workflow-monitor observes execution and flags:
- Command failures (exit codes > 0)
- Timeout events
- Repeated retry patterns
- Context exhaustion
- Inefficient tool usage

## Detection Patterns

### Error Detection

| Pattern | Signal | Severity |
|---------|--------|----------|
| Command failure | Exit code > 0 | High |
| Timeout | Exceeded timeout limit | High |
| Retry loop | Same command >3 times | Medium |
| Context exhaustion | >90% context used | Medium |
| Tool misuse | Wrong tool for task | Low |

### Efficiency Detection

| Pattern | Signal | Threshold |
|---------|--------|-----------|
| Verbose output | >1000 lines from command | 500 lines recommended |
| Redundant reads | Same file read >2 times | 2 reads max |
| Sequential vs parallel | Independent tasks run sequentially | Should parallelize |
| Over-fetching | Read entire file when snippet needed | Use offset/limit |

## Workflow

### Phase 1: Capture (`workflow-monitor:capture-complete`)

1. **Log execution events** - Commands, outputs, timing
2. **Tag anomalies** - Failures, timeouts, inefficiencies
3. **Store evidence** - For reproducibility

### Phase 2: Analyze (`workflow-monitor:analysis-complete`)

1. **Classify issues** - Error type, severity, scope
2. **Identify root cause** - What triggered the issue
3. **Suggest fix** - What would prevent recurrence

### Phase 3: Report (`workflow-monitor:report-generated`)

1. **Generate issue body** - Structured format
2. **Assign labels** - workflow, bug, enhancement
3. **Link evidence** - Command outputs, session info

### Phase 4: Create Issue (`workflow-monitor:issue-created`)

1. **Check for duplicates** - Search existing issues
2. **Create if unique** - Via gh CLI
3. **Link to session** - For traceability

## Issue Template

```markdown
## Background

Detected during workflow execution on [DATE].

**Source:** [workflow name] session [session-id]

## Problem

[Description of the error or inefficiency]

**Evidence:**
```
[Command that failed or was inefficient]
[Output excerpt]
```

## Suggested Fix

[What should change to prevent this]

## Acceptance Criteria

- [ ] [Specific fix criterion]
- [ ] Tests added for new behavior
- [ ] Documentation updated

---
*Created automatically by workflow-monitor*
```

## Configuration

```yaml
# .workflow-monitor.yaml
enabled: true
auto_create_issues: false  # Require approval before creating
severity_threshold: "medium"  # Only report medium+ severity
efficiency_threshold: 0.7  # Flag workflows below 70% efficiency

detection:
  command_failures: true
  timeouts: true
  retry_loops: true
  context_exhaustion: true
  tool_misuse: true

efficiency:
  verbose_output_limit: 500
  max_file_reads: 2
  parallel_detection: true
```

## Guardrails

1. **No duplicate issues** - Check existing issues before creating
2. **Approval required** - Unless `auto_create_issues: true`
3. **Evidence required** - Every issue must have reproducible evidence
4. **Rate limiting** - Max 5 issues per session

## Required TodoWrite Items

1. `workflow-monitor:capture-complete`
2. `workflow-monitor:analysis-complete`
3. `workflow-monitor:report-generated`
4. `workflow-monitor:issue-created` (if issue created)

## Integration Points

- **`imbue:proof-of-work`**: Captures execution evidence
- **`sanctum:fix-workflow`**: Implements suggested fixes
- **Hooks**: Can be triggered by session hooks for automatic monitoring

## Output Format

### Efficiency Report

```markdown
## Workflow Efficiency Report

**Session:** [session-id]
**Duration:** 12m 34s
**Efficiency Score:** 0.72 (72%)

### Issues Detected

| Type | Count | Impact |
|------|-------|--------|
| Verbose output | 3 | Medium |
| Redundant reads | 2 | Low |
| Sequential tasks | 1 | Medium |

### Recommendations

1. Use `--quiet` flags for npm/pip commands
2. Cache file contents instead of re-reading
3. Parallelize independent file operations

### Create Issues?

- [ ] Issue 1: Verbose output from npm install
- [ ] Issue 2: Redundant file reads in validation
```

## Related Skills

- `imbue:proof-of-work`: Evidence capture methodology
- `sanctum:fix-workflow`: Workflow improvement command
- `imbue:proof-of-work`: Validation methodology

---

**Status:** Skeleton implementation. Requires:
- Hook integration for automatic monitoring
- Efficiency scoring algorithm
- Duplicate detection logic
