---
name: session-routing
description: |
  Route work to parent context, subagents, or dedicated
  sessions based on complexity. Keeps single-area deep
  work in the parent thread; delegates multi-area work
  to subagents or sessions.
category: coordination
---

# Session Routing

Decide whether work should stay in the parent context,
use subagents, or run in dedicated sessions based on
the number of areas and the nature of the work.

## Routing Rules

| Condition | Route | Reason |
|-----------|-------|--------|
| Single area, deep work | Parent context | No coordination overhead; full context for reasoning and iteration |
| 1-3 areas, focused scope | Subagent | Low coordination overhead, parent context can handle results |
| 4+ areas | Dedicated sessions | Each area needs full context window, parallel subagents degrade |
| Codebase-wide | Sequential sessions | One area at a time, results accumulate in files |

## Decision Logic

```python
from scripts.agent_memory import decide_session_routing

decision = decide_session_routing(
    files=["plugins/imbue/a.py", "plugins/conserve/b.py"],
    areas=["plugins/imbue", "plugins/conserve"],
)
# Returns RoutingDecision.SUBAGENT (2 areas < 4 threshold)
```

## Parent Context Route

- Work stays in the main conversation thread
- No subagent overhead; full context available for
  reasoning, iteration, and follow-up questions
- Best when the task requires deep understanding of
  prior conversation or the user wants to steer
  decisions interactively
- Use when the user explicitly wants to avoid
  subagents or when the work is exploratory

## Subagent Route

- Standard Task tool dispatch
- Each agent gets a tight scope prompt
- Results return through parent context
- Works well for 1-3 focused areas

## Dedicated Session Route

- Use Agent Teams or separate tmux panes
- Each session gets a full clean context window
- Coordinate via `.coordination/` files (see
  findings-format module)
- Parent reads only summaries for synthesis

## Sequential Route

- For codebase-wide operations
- Process one area at a time
- Each session completes before the next begins
- Results accumulate in `.coordination/agents/`
- Final synthesis session reads all findings

## Integration

- `decide_session_routing()` in `scripts/agent_memory.py`
  implements the decision logic
- Integrates with `plan-before-large-dispatch` rule
  (4+ areas trigger plan mode)
- Area-specific context comes from plugin CLAUDE.md
  files and skill descriptions
