---
name: agent-expenditure
description: |
  >- Track per-agent token usage and flag waste patterns in parallel dispatch workflows. Consult after running parallel agents to evaluate whether expenditure was proportional to value. Cross-references the plan-before-large-dispatch rule
version: 1.8.1
triggers:
  - token-waste
  - agent-coordination
  - brooks-law
  - parallel-dispatch
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conserve", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.modules/waste-signals.md"]}}}
source: claude-night-market
source_plugin: conserve
---

> **Night Market Skill** — ported from [claude-night-market/conserve](https://github.com/athola/claude-night-market/tree/master/plugins/conserve). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Agent Token Waste Monitoring

## When To Use

- After parallel agent dispatch completes
- When evaluating whether to increase agent count
- During retrospectives on agent-heavy workflows
- When plan-before-large-dispatch rule triggers

## When NOT To Use

- Single-agent workflows (no coordination overhead)
- During active agent execution (post-hoc analysis)
- For token budgeting (use token-conservation instead)

## Brooks's Law for Agents

Dispatching more agents does not always help. Coordination overhead
grows with agent count:

| Agent Count | Expected Overhead | Guidance |
|-------------|-------------------|----------|
| 1-3 | Negligible | Dispatch freely |
| 4-5 | 10-15% | Acceptable; plan first |
| 6-8 | 20-30% | Monitor closely |
| 9+ | 30%+ | Likely counterproductive |

Coordination overhead is measured as shared-file conflicts: concurrent
Read/Write operations on the same file by different agents, as a
percentage of total agent runtime.

## Post-Dispatch Review Checklist

After parallel agent runs, evaluate:

1. Did each agent produce unique findings?
2. Was total token expenditure proportional to value?
3. Did any agent duplicate another's work?
4. Would fewer agents have produced the same result?

If 2+ questions answer no, reduce agent count in future dispatches
of the same type.

## Waste Signals

See `modules/waste-signals.md` for the 5 waste signal categories and
detection criteria.

## Cross-References

- `.claude/rules/plan-before-large-dispatch.md` for the 4+ agent
  planning requirement
- `conserve:token-conservation` for session-level token budgeting
- `conjure:agent-teams` for dispatch coordination
