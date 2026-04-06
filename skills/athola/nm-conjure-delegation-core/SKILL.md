---
name: delegation-core
description: Delegate tasks to external LLM services (Gemini, Qwen) with quota, logging,
version: 1.8.1
triggers:
  - delegation
  - external-llm
  - gemini
  - qwen
  - task-management
  - quality-control
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conjure", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.leyline:quota-management", "night-market.leyline:usage-logging", "night-market.leyline:service-registry", "night-market.leyline:error-patterns", "night-market.leyline:authentication-patterns"]}}}
source: claude-night-market
source_plugin: conjure
---

> **Night Market Skill** — ported from [claude-night-market/conjure](https://github.com/athola/claude-night-market/tree/master/plugins/conjure). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Philosophy](#philosophy)
- [Delegation Flow](#delegation-flow)
- [Quick Decision Matrix](#quick-decision-matrix)
- [Detailed Workflow Steps](#detailed-workflow-steps)
- [1. Task Assessment (`delegation-core:task-assessed`)](#1-task-assessment-delegation-coretask-assessed)
- [2. Suitability Evaluation (`delegation-core:delegation-suitability`)](#2-suitability-evaluation-delegation-coredelegation-suitability)
- [3. Handoff Planning (`delegation-core:handoff-planned`)](#3-handoff-planning-delegation-corehandoff-planned)
- [4. Execution & Integration (`delegation-core:results-integrated`)](#4-execution-integration-delegation-coreresults-integrated)
- [Leyline Infrastructure](#leyline-infrastructure)
- [Service-Specific Skills](#service-specific-skills)
- [Module Reference](#module-reference)
- [Exit Criteria](#exit-criteria)


# Delegation Core Framework

## Overview

A method for deciding when and how to delegate tasks to external LLM services. Core principle: **delegate execution, retain high-level reasoning**.

## When To Use
- Before invoking external LLMs for task assistance.
- When operations are token-heavy and exceed local context limits.
- When batch processing benefits from different model characteristics.
- When tasks require routing between models.

## When NOT To Use

- Task requires reasoning by Claude

## Philosophy

**Delegate execution, retain reasoning.** Claude handles architecture, strategy, design, and review. External LLMs perform data processing, pattern extraction, bulk operations, and summarization.

## Delegation Flow

1. **Task Assessment**: Classify task by complexity and context size.
2. **Suitability Evaluation**: Check prerequisites and service fit.
3. **Handoff Planning**: Formulate request and document plan.
4. **Execution & Integration**: Run delegation, validate, and integrate results.

## Quick Decision Matrix

| Complexity | Context | Recommendation |
|------------|---------|----------------|
| High | Any | Keep local |
| Low | Large | Delegate |
| Low | Small | Either |

**High Complexity**: Architecture, design decisions, trade-offs, creative problem solving.

**Low Complexity**: Pattern counting, bulk extraction, boilerplate generation, summarization.

## Detailed Workflow Steps

### 1. Task Assessment (`delegation-core:task-assessed`)

Classify the task:
- See `modules/task-assessment.md` for classification criteria.
- Use token estimates to determine thresholds.
- Apply the decision matrix.

**Exit Criteria**: Task classified with complexity level, context size, and delegation recommendation.

### 2. Suitability Evaluation (`delegation-core:delegation-suitability`)

Verify prerequisites:
- See `modules/handoff-patterns.md` for checklist.
- Evaluate cost-benefit ratio using `modules/cost-estimation.md`.
- Check for red flags (security, real-time iteration).

**Exit Criteria**: Service authenticated, quotas verified, cost justified.

### 3. Handoff Planning (`delegation-core:handoff-planned`)

Create a delegation plan:
- See `modules/handoff-patterns.md` for request template.
- Document service, command, input context, expected output.
- Define validation method.

**Exit Criteria**: Delegation plan documented.

### 4. Execution & Integration (`delegation-core:results-integrated`)

Execute and validate results:
- Run delegation and capture output.
- Validate format and correctness.
- Integrate only after validation passes.
- Log usage.

**Exit Criteria**: Results validated and integrated, usage logged.

## MCP Authentication

### OAuth Client Credentials (Claude Code 2.1.30+)

For MCP servers that don't support Dynamic Client Registration (e.g., Slack), pre-configured OAuth client credentials can be provided:

```bash
claude mcp add <server-name> --client-id <id> --client-secret <secret>
```

This enables delegation workflows through MCP servers that require pre-configured OAuth, expanding the range of external services available for task delegation.

### Claude.ai MCP Connectors (Claude Code 2.1.46+)

As an alternative to manual OAuth setup, users can configure MCP servers directly in claude.ai at claude.ai/settings/connectors. These connectors are automatically available in Claude Code when logged in with a claude.ai account — no `claude mcp add` or credential management required. This provides a browser-based auth flow that may be simpler for services with complex OAuth requirements.

## Worktree Isolation for File-Modifying Delegations (Claude Code 2.1.49+)

When delegating tasks that modify files to subagents, use `isolation: worktree` in the agent frontmatter to run each agent in a temporary git worktree. This prevents file conflicts when multiple delegated agents operate in parallel on overlapping paths. The worktree is auto-cleaned if no changes are made; preserved with commits if the agent produces changes.

```yaml
# Agent frontmatter for isolated delegation
isolation: worktree
```

## Leyline Infrastructure

Conjure uses leyline infrastructure:

| Leyline Skill | Used For |
|---------------|----------|
| `quota-management` | Track service quotas and thresholds. |
| `usage-logging` | Session-aware audit trails. |
| `service-registry` | Unified service configuration. |
| `error-patterns` | Consistent error handling. |
| `authentication-patterns` | Auth verification. |

See `modules/cost-estimation.md` for leyline integration examples.

## Service-Specific Skills

For detailed service workflows:
- `Skill(conjure:gemini-delegation)`: Gemini CLI specifics.
- `Skill(conjure:qwen-delegation)`: Qwen MCP specifics.

## Execution Modes

When delegating to multiple agents, choose the appropriate
execution mode:

| Mode | When to Use | How It Works |
|------|-------------|--------------|
| single-session | Sequential tasks, same-file edits | Claude works through tasks in order |
| subagents | Parallel independent tasks | Agents work independently, report back |
| agent-team | Parallel coordinated tasks | Agents can communicate with each other |

See `references/execution-modes.md` for the selection decision
matrix, mode compatibility notes, and anti-patterns to avoid.

## Module Reference

- **task-assessment.md**: Complexity classification, decision matrix.
- **cost-estimation.md**: Pricing, budgets, cost tracking.
- **handoff-patterns.md**: Request templates, workflows.
- **troubleshooting.md**: Common problems, service failures.

## Exit Criteria

- [ ] Task assessed and classified.
- [ ] Delegation decision justified.
- [ ] Results validated before integration.
- [ ] Lessons captured.
