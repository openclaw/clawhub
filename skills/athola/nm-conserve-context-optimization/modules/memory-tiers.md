---
name: memory-tiers
description: |
  Three-tier agent memory convention. Hot tier (always
  loaded, 200-line limit), warm tier (on-demand topics),
  cold tier (searchable archive).
category: memory-management
---

# Three-Tier Agent Memory

Long-running or frequently-invoked agents use a tiered
memory hierarchy to keep context lean and prioritized.

## Directory Structure

```
{agent-dir}/
  memory.md          # Hot tier: 200-line limit
  topics/
    validation.md    # Warm tier: on-demand
    patterns.md
  archive/
    2026-02.md       # Cold tier: historical
    2026-03.md
```

## Hot Tier: memory.md

- **Always loaded** at session start
- **200-line hard limit** -- forces prioritization
- Contains: current priorities, active warnings,
  recent decisions, next actions
- Updated every session

## Warm Tier: topics/

- **Pulled on demand** when the agent's task relates
  to a specific topic
- Agent deliberately selects which topics to load
- Includes: research findings, analysis results,
  area-specific patterns
- Updated when new findings are produced

## Cold Tier: archive/

- **Searchable but never auto-loaded**
- Accessed only when investigating past decisions
- Contains: monthly summaries, historical records
- Updated at session end via triage

## Session-End Triage Protocol

At the end of every significant session:

1. Review hot tier for stale content (>1 week old,
   no longer relevant)
2. Demote stale hot-tier content to warm topics
3. Promote urgent warm-tier findings to hot tier
4. Archive old warm-tier content to cold tier
5. Verify hot tier is under 200-line limit

## Why This Works

- The 200-line constraint forces agents to decide
  what matters -- no unbounded accumulation
- Agents control what they remember, not a retrieval
  algorithm
- Warm tier provides depth without context pollution
- Cold tier preserves history without cost
- The file system IS the database -- zero infrastructure

## Integration

- `MemoryManager` class in `scripts/agent_memory.py`
  provides Python API for managing tiers
- Egregore orchestrator can use hot tier for cross-item
  context preservation
- Continuation agents should save state to warm tier
  before handoff
