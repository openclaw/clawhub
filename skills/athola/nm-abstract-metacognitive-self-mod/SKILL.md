---
name: metacognitive-self-mod
description: |
  Analyze and improve the improvement process. Use for detecting quality regressions and refining meta-optimization
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Metacognitive Self-Modification

Analyze the effectiveness of past skill improvements and
refine the improvement process itself. This is the core
innovation from the Hyperagents paper: not just improving
skills, but improving HOW skills are improved.

## Context Triggers (auto-invocation)

This skill should be invoked automatically when:

1. **Regression detected**: The homeostatic monitor finds
   a skill's evaluation window ended in
   `pending_rollback_review` status. The improvement
   made things worse -- we need to understand why.

2. **Low effectiveness rate**: When
   `ImprovementMemory.get_effective_strategies()` vs
   `get_failed_strategies()` shows effectiveness below
   50%, the improvement process itself needs refinement.

3. **Degradation despite improvements**: When
   `PerformanceTracker.get_improvement_trend()` returns
   negative for a skill that was recently improved.

4. **Periodic check**: After every 10 improvement cycles
   (tracked via outcome count in ImprovementMemory).

### Hook integration

The homeostatic monitor emits
`"improvement_triggered": true` when a skill crosses the
flag threshold. At that point, before dispatching the
skill-improver, check if metacognitive analysis is
warranted:

```python
from abstract.improvement_memory import ImprovementMemory
from pathlib import Path

memory = ImprovementMemory(
    Path.home() / ".claude/skills/improvement_memory.json"
)

# Check if metacognitive analysis is warranted
effective = memory.get_effective_strategies()
failed = memory.get_failed_strategies()
total = len(effective) + len(failed)

needs_metacognition = False

# Trigger 1: Low effectiveness rate
if total >= 5 and len(effective) / total < 0.5:
    needs_metacognition = True

# Trigger 2: Periodic check (every 10 outcomes)
if total > 0 and total % 10 == 0:
    needs_metacognition = True

# Trigger 3: Recent regression
if failed and failed[-1].get("outcome_type") == "failure":
    needs_metacognition = True

if needs_metacognition:
    # Run metacognitive analysis before next improvement
    pass  # Skill(abstract:metacognitive-self-mod)
```

## When To Use (Manual)

- After a batch of skill improvements to assess what
  worked
- When improvement outcomes show regressions
- Periodically (monthly) to refine improvement strategy
- When the skill-improver agent seems ineffective

## When NOT To Use

- Routine skill improvements (use skill-improver directly)
- First-time skill creation (use skill-authoring)

## Workflow

### Step 1: Load improvement data

Read improvement memory and performance tracker data:

```bash
# Check for improvement memory
MEMORY_FILE=~/.claude/skills/improvement_memory.json
TRACKER_FILE=~/.claude/skills/performance_history.json

if [ ! -f "$MEMORY_FILE" ]; then
  echo "No improvement memory found."
  echo "Run skill-improver first to generate improvement data."
  exit 0
fi
```

Load the JSON files using Python:

```python
from abstract.improvement_memory import ImprovementMemory
from abstract.performance_tracker import PerformanceTracker
from pathlib import Path

memory = ImprovementMemory(Path.home() / ".claude/skills/improvement_memory.json")
tracker = PerformanceTracker(Path.home() / ".claude/skills/performance_history.json")
```

### Step 2: Classify improvement outcomes

For each improvement outcome in memory, classify:

- **Effective**: `after_score - before_score >= 0.1`
- **Neutral**: `-0.1 < improvement < 0.1`
- **Regression**: `after_score < before_score`

```python
effective = memory.get_effective_strategies()
failed = memory.get_failed_strategies()

# Calculate effectiveness rate
total = len(effective) + len(failed)
if total > 0:
    effectiveness_rate = len(effective) / total
```

### Step 3: Extract meta-patterns

Analyze WHAT types of improvements succeed vs fail:

**Success patterns to look for**:

- Adding error handling (reduces failure rate)
- Adding examples (improves user ratings)
- Adding quiet/verbose modes (reduces friction)
- Simplifying workflow steps (reduces duration)

**Failure patterns to look for**:

- Over-engineering (adding too many options)
- Breaking existing workflows (regression)
- Adding complexity without validation
- Token budget overflow from verbose additions

For each pattern found, record as a causal hypothesis:

```python
memory.record_insight(
    skill_ref="_meta",  # Special ref for meta-insights
    category="causal_hypothesis",
    insight="Error handling improvements have 85% success rate",
    evidence=["skill-A v1.1.0: +0.3", "skill-B v2.1.0: +0.15"]
)
```

### Step 4: Analyze improvement trends

Use PerformanceTracker to identify:

- Skills with sustained improvement (positive trend)
- Skills with degradation despite improvement attempts
- Domains where improvements are most effective

```python
for skill_ref in tracker.get_all_skill_refs():
    trend = tracker.get_improvement_trend(skill_ref)
    if trend is not None:
        if trend > 0.05:
            # Sustained improvement - what's working?
            pass
        elif trend < -0.05:
            # Degrading despite improvements - investigate
            pass
```

### Step 5: Generate strategy recommendations

Based on the meta-analysis, generate recommendations for
the skill-improver:

1. **Priority formula adjustments**: If certain issue
   types have higher improvement success rates, weight
   them higher.

2. **Approach selection**: If "add error handling" has 85%
   success vs "restructure workflow" at 30%, bias toward
   error handling.

3. **Threshold adjustments**: If improvements below
   priority 3.0 consistently fail, raise the minimum
   threshold.

4. **Avoidance rules**: Document anti-patterns to avoid
   in future improvements.

### Step 6: Store meta-insights

Record all findings back into ImprovementMemory under the
special `_meta` skill ref:

```python
# Record strategy recommendation
memory.record_insight(
    skill_ref="_meta",
    category="strategy_success",
    insight="Recommendation: Prioritize error handling and examples over restructuring",
    evidence=[f"Success rate: error_handling={eh_rate:.0%}, restructure={rs_rate:.0%}"]
)
```

### Step 7: Update skill-improver strategy

If significant meta-insights are found, propose concrete
modifications to the skill-improver agent:

- Update priority weights in the priority formula
- Add avoidance rules for known anti-patterns
- Adjust thresholds based on empirical data
- Add new improvement patterns that proved effective

**Important**: Propose changes, do not auto-apply. The user
must approve modifications to the improvement process.

## Output

```
Metacognitive Self-Modification Report

Improvement Data:
  Total outcomes analyzed: 15
  Effective improvements: 11 (73%)
  Regressions: 2 (13%)
  Neutral: 2 (13%)

Success Patterns:
  1. Error handling additions: 5/6 success (83%)
  2. Example additions: 3/3 success (100%)
  3. Quiet mode additions: 2/2 success (100%)

Failure Patterns:
  1. Workflow restructuring: 1/3 success (33%)
  2. Token-heavy additions: 0/1 success (0%)

Performance Trends:
  Improving: 8 skills (positive trend)
  Stable: 4 skills (no trend)
  Degrading: 1 skill (negative trend despite attempts)

Recommendations:
  1. Weight error handling improvements 2x in priority
  2. Avoid workflow restructuring below priority 8.0
  3. Cap additions at 200 tokens to prevent budget overflow
  4. Focus next improvement cycle on degrading skill X

Meta-insights stored: 5 new entries in improvement memory
```

## Related

- `abstract:skill-improver` - The agent this skill analyzes
  and proposes modifications for
- `abstract:skills-eval` - Evaluation framework whose
  criteria could be refined by meta-insights
- `abstract:aggregate-logs` - Data source for improvement
  metrics
