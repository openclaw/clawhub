---
name: risk-classification
description: |
  'Inline risk classification for agent tasks using a 4-tier model. Hybrid routing: GREEN/YELLOW use heuristic file-pattern matching, RED/CRITICAL escalate to war-room-checkpoint for full reversibility scoring.'
version: 1.8.1
triggers:
  - risk
  - classification
  - safety
  - verification
  - gates
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.error-patterns"]}}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [4-Tier Risk Model](#4-tier-risk-model)
- [Hybrid Routing](#hybrid-routing)
- [Task Metadata Extension](#task-metadata-extension)
- [Module Reference](#module-reference)
- [Integration Pattern](#integration-pattern)
- [Exit Criteria](#exit-criteria)


# Risk Classification

## Overview

Provides inline risk classification for agent tasks using a 4-tier model (GREEN/YELLOW/RED/CRITICAL). Uses fast heuristic file-pattern matching for low-risk tiers and delegates to `Skill(attune:war-room-checkpoint)` for high-risk tiers requiring full reversibility scoring.

## When To Use

- Assessing risk of tasks before agent assignment
- Determining verification requirements for task completion
- Deciding parallel execution safety between tasks
- Adding risk markers to task checklists

## When NOT To Use

- Single-file trivial changes (assume GREEN)
- Strategic architecture decisions (use full `Skill(attune:war-room)` instead)
- Non-code tasks (documentation-only, configuration comments)

## 4-Tier Risk Model

| Tier | Color | Scope | Example | Verification |
|------|-------|-------|---------|-------------|
| **GREEN** | Safe | Single file, trivial revert | Test files, docs, utils | None required |
| **YELLOW** | Caution | Module-level, user-visible | Components, routes, views | Conflict check + test pass |
| **RED** | Danger | Cross-module, security/data | Migrations, auth, database schema | War-room RS + full test + review |
| **CRITICAL** | Stop | Irreversible, regulated | Data deletion, production deploy | War-room RS + human approval |

## Hybrid Routing

```
Task received
    |
    v
Heuristic classifier (file patterns)
    |
    ├── GREEN/YELLOW → Apply tier, continue
    |
    └── RED/CRITICAL → Invoke Skill(attune:war-room-checkpoint)
                        for reversibility scoring (RS)
                        |
                        └── RS confirms or adjusts tier
```

**Why hybrid**: GREEN/YELLOW classification is fast and deterministic (file pattern matching). RED/CRITICAL tasks warrant the overhead of full reversibility analysis because the cost of getting them wrong is high.

## Task Metadata Extension

Add risk tier to task metadata for downstream consumption:

```json
{
  "id": "5",
  "subject": "Add user authentication",
  "metadata": {
    "risk_tier": "YELLOW",
    "risk_reason": "Modifies src/components/LoginForm.tsx (user-visible component)",
    "classified_at": "2026-02-07T22:00:00Z"
  }
}
```

Tasks without `risk_tier` metadata default to **GREEN** (backward compatible).

## Readiness Levels

The 4-tier Readiness Levels system provides clear risk
classification with required controls per tier:

| Level | Name | When | Required Controls |
|-------|------|------|-------------------|
| 0 | Routine | Low blast radius, easy rollback | Basic validation, rollback step |
| 1 | Watch | User-visible changes | Review, negative test, rollback note |
| 2 | Elevated | Security/compliance/data | Adversarial review, risk checklist |
| 3 | Critical | Irreversible, regulated | Human confirmation, two-step verification |

See `modules/readiness-levels.md` for full level definitions,
selection decision tree, and integration guidance.

## Module Reference

- **tier-definitions.md**: Detailed tier criteria, boundaries, and override mechanism
- **heuristic-classifier.md**: File-pattern rules for automated classification
- **verification-gates.md**: Per-tier verification requirements and parallel safety matrix
- **readiness-levels.md**: 4-tier risk system with required controls per level

## Integration Pattern

```yaml
# In your skill's frontmatter
dependencies: [leyline:risk-classification]
```

### For Task Generators

Append `[R:TIER]` marker to task format:

```markdown
- [ ] T012 [P] [US1] [R:YELLOW] Create LoginForm component in src/components/LoginForm.tsx
```

### For Orchestrators

Check risk tier before task assignment:

```
if task.risk_tier in ["RED", "CRITICAL"]:
    invoke Skill(attune:war-room-checkpoint) for RS scoring
    if CRITICAL: require human approval before proceeding
```

## Exit Criteria

- Every task has a risk tier assigned (explicit or default GREEN)
- RED/CRITICAL tasks have war-room-checkpoint RS scores
- Verification gates passed for the assigned tier
- No parallel execution of prohibited tier combinations
