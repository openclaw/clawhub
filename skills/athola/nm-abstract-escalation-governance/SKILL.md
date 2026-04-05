---
name: escalation-governance
description: Assess whether to escalate models
version: 1.8.1
triggers:
  - escalation
  - model-selection
  - governance
  - agents
  - orchestration
  - evaluating reasoning depth
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [The Iron Law](#the-iron-law)
- [When to Escalate](#when-to-escalate)
- [When NOT to Escalate](#when-not-to-escalate)
- [Decision Framework](#decision-framework)
- [1. Have I understood the problem?](#1-have-i-understood-the-problem)
- [2. Have I investigated systematically?](#2-have-i-investigated-systematically)
- [3. Is escalation the right solution?](#3-is-escalation-the-right-solution)
- [4. Can I justify the trade-off?](#4-can-i-justify-the-trade-off)
- [Escalation Protocol](#escalation-protocol)
- [Common Rationalizations](#common-rationalizations)
- [Agent Schema](#agent-schema)
- [Orchestrator Authority](#orchestrator-authority)
- [Red Flags - STOP and Investigate](#red-flags-stop-and-investigate)
- [Integration with Agent Workflow](#integration-with-agent-workflow)
- [Quick Reference](#quick-reference)


# Escalation Governance

## Overview

Model escalation (haiku→sonnet→opus) trades speed/cost for reasoning capability. This trade-off must be justified.

**Core principle:** Escalation is for tasks that genuinely require deeper reasoning, not for "maybe a smarter model will figure it out."

## The Iron Law

```
NO ESCALATION WITHOUT INVESTIGATION FIRST
```
**Verification:** Run the command with `--help` flag to verify availability.

Escalation is never a shortcut. If you haven't understood why the current model is insufficient, escalation is premature.

## When to Escalate

**Legitimate escalation triggers:**

| Trigger | Description | Example |
|---------|-------------|---------|
| Genuine complexity | Task inherently requires nuanced judgment | Security policy trade-offs |
| Reasoning depth | Multiple inference steps with uncertainty | Architecture decisions |
| Novel patterns | No existing patterns apply | First-of-kind implementation |
| High stakes | Error cost justifies capability investment | Production deployment |
| Ambiguity resolution | Multiple valid interpretations need weighing | Spec clarification |

## When NOT to Escalate

**Illegitimate escalation triggers:**

| Anti-Pattern | Why It's Wrong | What to Do Instead |
|--------------|----------------|---------------------|
| "Maybe smarter model will figure it out" | This is thrashing | Investigate root cause |
| Multiple failed attempts | Suggests wrong approach, not insufficient capability | Question your assumptions |
| Time pressure | Urgency doesn't change task complexity | Systematic investigation is faster |
| Uncertainty without investigation | You haven't tried to understand yet | Gather evidence first |
| "Just to be safe" | False safety - wastes resources | Assess actual complexity |

## Decision Framework

Before escalating, answer these questions:

### 1. Have I understood the problem?

- [ ] Can I articulate why the current model is insufficient?
- [ ] Have I identified what specific reasoning capability is missing?
- [ ] Is this a capability gap or a knowledge gap?

**If knowledge gap:** Gather more information, don't escalate.

### 2. Have I investigated systematically?

- [ ] Did I read error messages/outputs carefully?
- [ ] Did I check for similar solved problems?
- [ ] Did I form and test a hypothesis?

**If not investigated:** Complete investigation first.

### 3. Is escalation the right solution?

- [ ] Would a different approach work at current model level?
- [ ] Is the task inherently complex, or am I making it complex?
- [ ] Would breaking the task into smaller pieces help?

**If decomposable:** Break down, don't escalate.

### 4. Can I justify the trade-off?

- [ ] What's the cost (latency, tokens, money) of escalation?
- [ ] What's the benefit (accuracy, safety, completeness)?
- [ ] Is the benefit proportional to the cost?

**If not proportional:** Don't escalate.

## Escalation Protocol

When escalation IS justified:

1. **Document the reason** - State why current model is insufficient
2. **Specify the scope** - What specific subtask needs higher capability?
3. **Define success** - How will you know the escalated task succeeded?
4. **Return promptly** - Drop back to efficient model after reasoning task

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This is complex" | Complex for whom? Have you tried? |
| "Better safe than sorry" | Safety theater wastes resources |
| "I tried and failed" | How many times? Did you investigate why? |
| "The user expects quality" | Quality comes from process, not model size |
| "Just this once" | Exceptions become habits |
| "Time is money" | Systematic approach is faster than thrashing |

## Agent Schema

Agents can declare escalation hints in frontmatter:

```yaml
model: haiku
escalation:
  to: sonnet                 # Suggested escalation target
  hints:                     # Advisory triggers (orchestrator may override)
    - security_sensitive     # Touches auth, secrets, permissions
    - ambiguous_input        # Multiple valid interpretations
    - novel_pattern          # No existing patterns apply
    - high_stakes            # Error would be costly
```
**Verification:** Run the command with `--help` flag to verify availability.

**Key points:**
- Hints are advisory, not mandatory
- Orchestrator has final authority
- Orchestrator can escalate without hints (broader context)
- Orchestrator can ignore hints (task is actually simple)

## Orchestrator Authority

The orchestrator (typically Opus) makes final escalation decisions:

**Can follow hints:** When hint matches observed conditions
**Can override to escalate:** When context demands it (even without hints)
**Can override to stay:** When task is simpler than hints suggest
**Can escalate beyond hint:** Go to opus even if hint says sonnet

The orchestrator's judgment, informed by conversation context, supersedes static hints.

## Red Flags - STOP and Investigate

If you catch yourself thinking:
- "Let me try with a better model"
- "This should be simple but isn't working"
- "I've tried everything" (but haven't investigated why)
- "The smarter model will know what to do"
- "I don't understand why this isn't working"

**ALL of these mean: STOP. Investigate first.**

## Integration with Agent Workflow

```
**Verification:** Run the command with `--help` flag to verify availability.
Agent starts task at assigned model
├── Task succeeds → Complete
└── Task struggles →
    ├── Investigate systematically
    │   ├── Root cause found → Fix at current model
    │   └── Genuine capability gap → Escalate with justification
    └── Don't investigate → WRONG PATH
        └── "Maybe escalate?" → NO. Investigate first.
```
**Verification:** Run the command with `--help` flag to verify availability.

## Quick Reference

| Situation | Action |
|-----------|--------|
| Task inherently requires nuanced reasoning | Escalate |
| Agent uncertain but hasn't investigated | Investigate first |
| Multiple attempts failed | Question approach, not model |
| Security/high-stakes decision | Escalate |
| "Maybe smarter model knows" | Never escalate on this basis |
| Hint fires, task is actually simple | Override, stay at current model |
| No hint fires, task is actually complex | Override, escalate |

## Model Capability Notes

**MCP Tool Search (Claude Code 2.1.7+)**: Haiku models do not support MCP tool search. If a workflow uses many MCP tools (descriptions exceeding 10% of context), those tools load upfront on haiku instead of being deferred. This can consume significant context. Consider escalating to sonnet for MCP-heavy workflows or ensure haiku agents use only native tools (Read, Write, Bash, etc.).

**Claude.ai MCP Connectors (Claude Code 2.1.46+)**: Users with claude.ai connectors configured may have additional MCP tools auto-loaded, increasing the total tool description footprint. This makes it more likely that haiku agents will exceed the 10% tool search threshold. When escalation decisions involve MCP-heavy workflows, factor in claude.ai connector tool count via `/mcp`.

**Effort Controls as Escalation Alternative (Opus 4.6 / Claude Code 2.1.32+)**: Opus 4.6 introduces adaptive thinking with effort levels (`low`, `medium`, `high`). The `max` level was removed in 2.1.72; `high` is now the ceiling. Symbols: ○ (low) ◐ (medium) ● (high). Use `/effort auto` to reset to default. Before escalating between models, consider whether adjusting effort on the current model would suffice:

| Instead of... | Consider... | When |
|--------------|-------------|------|
| Haiku → Sonnet | Stay on Haiku | Task is still deterministic, just needs more context |
| Sonnet → Opus | Opus@medium | Moderate reasoning, not deep architectural analysis |
| Opus@medium → "maybe try again" | Opus@high or "ultrathink" | Genuine complexity needing deeper reasoning |

**Default effort change (2.1.68+)**: Opus 4.6 now
defaults to **medium effort** for Max and Team
subscribers. Use `/model` to change effort level, or
type "ultrathink" in your prompt to enable high effort
for the next turn.

**Opus 4/4.1 removed (2.1.68+)**: Opus 4 and 4.1 are
no longer available on the first-party API. Users with
these models pinned are automatically migrated to
Opus 4.6. No action needed for agents using `model`
frontmatter, as the migration is transparent.

**Sonnet 4.5 → 4.6 migration (2.1.69+)**: Sonnet 4.5
users on Pro/Max/Team Premium are automatically migrated
to Sonnet 4.6. Agent model frontmatter referencing
Sonnet resolves transparently. The `--model` flags for
`claude-opus-4-0` and `claude-opus-4-1` now correctly
resolve to Opus 4.6 instead of deprecated versions.

**Effort parameter fix (2.1.70+)**: Fixed API 400 error
`This model does not support the effort parameter` when
using custom Bedrock inference profiles or non-standard
Claude model identifiers. Effort controls now work
reliably across all deployment configurations.

**Default Opus 4.6 on providers (2.1.73+)**: Bedrock,
Vertex, and Microsoft Foundry now default to Opus 4.6
(was Opus 4.1). Subagent `model: opus`/`sonnet`/`haiku`
aliases now resolve to the current version on all
providers; previously they were silently downgraded to
older versions (e.g., Opus 4.1 instead of 4.6). This
fix means agent dispatch workflows on third-party
providers now match first-party API behavior.

**`modelOverrides` setting (2.1.73+)**: Maps model
picker entries to provider-specific IDs (Bedrock
inference profile ARNs, Vertex version names, Foundry
deployment names). Use when routing model selections to
specific inference profiles. See the model optimization
guide for configuration details.

**`/output-style` deprecated (2.1.73+)**: Use `/config`
instead. Output style is now fixed at session start for
better prompt caching.

**Full model IDs in agent frontmatter (2.1.74+)**: Agent
`model:` fields now accept full model IDs (e.g.,
`claude-opus-4-6`) in addition to aliases (`opus`,
`sonnet`, `haiku`). Previously, full IDs were silently
ignored. Agents now accept the same values as `--model`.

Effort controls do NOT replace the escalation governance
framework: they provide an additional axis. The Iron Law
still applies: investigate before changing either model
or effort level.

## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
