# Integration

This module defines how consuming skills wire utility scoring into their
orchestration loops.
Two modes are available: advisory (default, no setup required) and
prescriptive (opt-in, frontmatter-controlled).

## Advisory Mode

Advisory mode requires no frontmatter changes.
The skill author adds a short evaluation block before each action decision.

4-step checklist:

1. Construct state per `leyline:utility/modules/state-builder`
2. Score candidates per `leyline:utility/modules/action-selector`
3. Prefer the highest-utility action unless you have a specific reason
   to override
4. Log the score and your decision before executing the action

Consumer can override the selected action with stated reasoning.
The override must be recorded in the reasoning trace alongside the
utility score.

**What to add to your skill:**

```
Before taking your next action, evaluate utility:
1. Construct state per leyline:utility/modules/state-builder
2. Score candidates per leyline:utility/modules/action-selector
3. Prefer the highest-utility action unless you have a
   specific reason to override
4. Log the score and your decision
```

## Prescriptive Mode

Prescriptive mode enforces utility gating via frontmatter keys.
The skill MUST follow the selected action; overrides are not permitted
unless `Gain >= 0.7` (document the override and gain value).

**Frontmatter keys:**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `utility_gated` | bool | false | Enable prescriptive mode |
| `utility_floor` | float | -0.5 | Skip actions scoring below this |
| `utility_max_steps` | int | 10 | Step budget before forced stop |
| `utility_lambdas` | float[3] | [1.0, 0.5, 0.8] | λ₁, λ₂, λ₃ weights |

**Validation rules:**

- `utility_lambdas`: 3-element list of floats, each >= 0.
  Falls back to `[1.0, 0.5, 0.8]` if invalid.
- `utility_floor`: must be in `[-2.3, 1.0]`.
  Falls back to `-0.5` if out of range.
- `utility_max_steps`: positive integer.
  Falls back to `10` if zero or negative.

**Example frontmatter block:**

```yaml
---
name: my-skill
utility_gated: true
utility_floor: -0.3
utility_max_steps: 8
utility_lambdas: [1.0, 0.5, 0.8]
---
```

## Dispatch Mode

Dispatch mode applies when a parent orchestrator manages subagents.
Construct state with `scope: "dispatch"` and evaluate utility before
launching each additional agent.

Per-agent utility evaluation follows the same formula but draws on
dispatch-scope signals: `agents_pending`, `total_agent_tokens`, and
`coordination_overhead`.
Brooks's Law applies: adding agents to a late or saturated task
increases coordination overhead faster than it increases throughput,
driving `StepCost` up and utility down.

**Decision pattern:**

```
if U(delegate) < U(respond):
    synthesize current results and respond
else:
    launch agent N+1
```

Do not launch agent N+1 if utility of delegation is below
`utility_floor`.
Synthesize the results already in hand instead.

## Consumer Adoption Path

| Phase | Consumer | Mode | Impact |
|-------|----------|------|--------|
| 1 | do-issue, attune:execute | Prescriptive (dispatch) | Gate agent count |
| 2 | egregore orchestrator | Prescriptive (dispatch) | Utility-ranked queue |
| 3 | conjure delegation-core | Advisory | Model tier selection |
| 4 | Any skill | Advisory | Opt-in awareness |

## Example: Prescriptive in do-issue Dispatch

Before launching agent N+1, do-issue constructs dispatch-scope state
and checks utility:

```
state:
  scope: "dispatch"
  step: N
  agents_completed: N
  agents_pending: 0
  total_agent_tokens: <sum so far>
  coordination_overhead: <estimated from agent count>
  budget_remaining_ratio: (max_steps - N) / max_steps

Score U(delegate | s_N):
  Gain: estimated new evidence from agent N+1
  StepCost: λ₁ × cost of one more agent call
  Uncertainty: λ₂ × confidence in remaining scope
  Redundancy: λ₃ × overlap with prior agent findings

if U(delegate) < utility_floor (-0.3):
    stop dispatch, synthesize findings from agents 1..N
else:
    launch agent N+1
```

This pattern caps runaway agent counts without hard-coding a limit.
The utility score adapts to observed evidence density and remaining
budget rather than a fixed agent ceiling.
