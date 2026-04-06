---
name: catchup
description: |
  Summarize recent changes from git history for context recovery, handoffs, and sprint review
version: 1.8.1
triggers:
  - summarization
  - context-acquisition
  - insights
  - follow-ups
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/imbue", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: imbue
---

> **Night Market Skill** — ported from [claude-night-market/imbue](https://github.com/athola/claude-night-market/tree/master/plugins/imbue). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Activation](#activation)
- [Progressive Loading](#progressive-loading)
- [4-Step Methodology](#4-step-methodology)
- [Output Format](#output-format)

# Catchup Analysis Methodology

## Overview

Structured method for quickly understanding recent changes in git repositories, meeting notes, sprint progress, document revisions, or system logs. Answers "what changed and what matters?" efficiently.

## When To Use
- Joining ongoing work or returning after absence
- Before planning or reviewing handoffs
- Any "what happened and what's next" context

## When NOT To Use

- Doing detailed
  diff analysis - use diff-analysis instead
- Full code review needed
  - use review-core instead
- Doing detailed
  diff analysis - use diff-analysis instead
- Full code review needed
  - use review-core instead

## Activation
**Keywords**: catchup, summary, status, progress, context, handoff
**Cues**: "get me up to speed", "current status", "summarize progress"

## Progressive Loading

Load modules based on context:

**Git**: Load `modules/git-catchup-patterns.md` for git commands. Consider `sanctum:git-workspace-review` for initial data gathering.

**Documents/Notes**: Load `modules/document-analysis-patterns.md` for meeting notes, sprint tracking, document revisions.

**Logs/Events**: Load `modules/log-analysis-patterns.md` for time-series and metric analysis.

**Always Available**: `imbue:proof-of-work`, TodoWrite workflow, structured output.

## Required TodoWrite Items
1. `catchup:context-confirmed` - Boundaries established
2. `catchup:delta-captured` - Changes enumerated
3. `catchup:insights-extracted` - Themes identified
4. `catchup:followups-recorded` - Actions captured

## 4-Step Methodology

### Step 1: Confirm Context
Define scope (git branch, sprint, meetings), baseline (last state), and current target. See modules for commands.

### Step 2: Capture Delta
Enumerate changed items with metrics. Prioritize source/config/docs over generated artifacts. See modules for strategies.

### Step 3: Extract Insights
Per item: **What** (change), **Why** (motivation), **Implications** (tests/risks/deps). Rollup into themes.

### Step 4: Record Follow-ups
Capture: Tests, Documentation, Reviews, Blockers, Questions. If none, state explicitly.

## Output Format
```
## Summary
[2-3 sentence theme + risk overview]

## Key Changes
- [Item]: [what/why/implication]

## Follow-ups
- [ ] [Action with owner]

## Blockers/Questions
- [Item requiring resolution]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Integration
Use `imbue:diff-analysis` for risk assessment, `imbue:proof-of-work` for reproducibility, `sanctum:git-workspace-review` for git data. Feed to `brainstorming` or `writing-plans` as needed.

## Token Conservation
Reference paths + lines (don't reproduce). Summarize outputs. Defer deep analysis. Use progressive loading.

## Exit Criteria
- Four TodoWrite items completed
- Context/delta/insights/follow-ups captured
- Stakeholders understand state without re-reading sources
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
