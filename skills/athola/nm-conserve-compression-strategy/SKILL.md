---
name: compression-strategy
description: |
  Analyze current context and recommend compression strategies for bloated or quota-heavy sessions
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conserve", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: conserve
---

> **Night Market Skill** — ported from [claude-night-market/conserve](https://github.com/athola/claude-night-market/tree/master/plugins/conserve). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Compression Strategy

Analyze current context usage and recommend optimal compression strategies.

## When To Use

- Context feels bloated or sluggish
- Before major task phase transitions (plan complete, starting implementation)
- Token quota burning faster than expected
- After large tool output accumulations

## When NOT To Use

- Context-optimization skill already handling the scenario
- Simple queries with minimal context
- Freshly cleared context

## Required TodoWrite Items

1. `compression-strategy:analyze-context`
2. `compression-strategy:recommend-strategy`
3. `compression-strategy:estimate-savings`

## Step 1 – Analyze Context (`analyze-context`)

Run `/context` to check current usage. Then estimate:

1. **Tool output accumulation**: How much context is from tool results vs. conversation?
2. **Stale content age**: How many turns since critical decisions were made?
3. **Active files**: Which files are still relevant vs. historical?

## Step 2 – Recommend Strategy (`recommend-strategy`)

Based on analysis, recommend one of:

### Option A: `/clear` + `/catchup`

Best when:
- Task phase complete (planning done, implementation starting)
- Context > 60% full
- Most content is stale

Process:
1. Save critical state to `.claude/session-state.md`
2. Run `/clear`
3. Run `/catchup` to reload active files

### Option B: Spawn Continuation Agent

Best when:
- Context > 80% full
- Work in progress, can't stop
- Delegatable tasks remain

Process:
1. Run `Skill(conserve:clear-context)` to spawn continuation agent
2. Agent receives fresh context with saved state

### Option C: Archive + Summarize

Best when:
- Context 40-60% full
- Some stale content mixed with active
- Not ready for full clear

Process:
1. Archive old decisions/errors to `.claude/context-archive/`
2. Summarize completed work in memory
3. Continue with leaner context

### Option D: Delegate to Subagent

Best when:
- Parallel work possible
- Independent subtasks exist
- Context pressure moderate

Process:
1. Identify delegatable tasks
2. Spawn specialized agents via `Task` tool
3. Main context stays lean

## Step 3 – Estimate Savings (`estimate-savings`)

For the recommended strategy, estimate:

| Strategy | Typical Savings | Risk |
|----------|-----------------|------|
| /clear + /catchup | 70-90% | Low if state saved |
| Continuation agent | 80-95% | Low, state preserved |
| Archive + summarize | 20-40% | Very low |
| Delegate to subagent | 30-50% | Low, parallel work |

## Context Archive Location

Preserved context is saved to:
```
.claude/context-archive/pre-compact-YYYYMMDD-HHMMSS-SESSIONID.md
```

This is automatically created by the `pre_compact_preserve` hook before
any `/compact` operation.

## Integration Points

- **PreCompact hook**: Automatically preserves context before compression
- **Tool output summarizer**: Warns when tool outputs accumulate
- **Context warning hook**: Three-tier alerts at 40%/50%/80%

## Example Usage

```
/compression-strategy
```

Output:
```
Context Analysis:
- Current usage: 52%
- Tool output: ~15KB (3 tool results)
- Stale content: ~40% (decisions from 8+ turns ago)

Recommendation: Option C - Archive + Summarize
- Archive old decisions to context-archive
- Keep active files and recent decisions
- Estimated savings: 25-35%

Commands:
1. Read .claude/context-archive/ to see what's preserved
2. Summarize completed work
3. Continue with leaner context
```
