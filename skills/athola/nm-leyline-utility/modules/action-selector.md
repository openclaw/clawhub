# Action Selector

Combines scores from all four utility components and selects
the highest-utility action for the current step.
Produces an action report that downstream consumers use to
drive execution.

## Input Requirements

- Session state from `state-builder` (scope, step, max_steps,
  lambda weights)
- Per-candidate scores: `Gain`, `StepCost`, `Uncertainty`,
  `Redundancy`

## Procedure

1. **Enumerate candidates** for the current scope (see
   Scope-Specific Action Sets below).

2. **Compute utility** for each candidate action `a`:

   ```
   U(a) = Gain - lambda_1*StepCost - lambda_2*Uncertainty
          - lambda_3*Redundancy
   ```

3. **Select** `a* = argmax U(a)` over all candidates.

4. **Check termination** conditions (see Termination Logic
   below).

5. **Produce** the action report (see Action Report Template
   below).

## Scope-Specific Action Sets

Different scopes expose different candidate actions.

**self** — the top-level Claude instance answering a user:

- `respond`, `retrieve`, `tool_call`, `verify`, `delegate`,
  `stop`
- `delegate` triggers a new dispatch-scope evaluation;
  the nested scope selects its own `a*` independently.

**subagent** — a spawned agent executing a delegated task:

- `respond`, `retrieve`, `tool_call`, `verify`, `stop`
- No `delegate`; subagents execute, they do not orchestrate.

**dispatch** — an orchestrator managing a fleet of subagents:

- `respond`, `delegate`, `retrieve`, `tool_call`, `verify`,
  `stop`

## Termination Logic

Evaluate in order after selecting `a*`:

1. If `a* == stop`: terminate.

2. If `step >= max_steps`: terminate regardless of utility.

3. If `max(U)` for all non-stop actions `< floor` (default
   `-0.5`): terminate, UNLESS the high-gain override applies.
   The override applies when `Gain >= 0.7` for at least one
   candidate action; in that case, proceed and document the
   override reason in the `Rationale` field of the report.

## Action Report Template

```
Action: <selected>
Utility: <score>
Breakdown: Gain=X StepCost=Y Uncertainty=Z Redundancy=W
Rationale: "<1-sentence justification>"
```

All four breakdown fields are required.
Utility is rounded to two decimal places.

## Canonical Worked Example

Given scores for a `tool_call` candidate:

```
Gain        = 0.7
StepCost    = 0.12
Uncertainty = 0.6
Redundancy  = 0.0
```

With lambda weights `[1.0, 0.5, 0.8]`:

```
U = 0.7 - 1.0*0.12 - 0.5*0.6 - 0.8*0.0
  = 0.7 - 0.12 - 0.30 - 0.0
  = 0.28
```

Resulting report:

```
Action: tool_call
Utility: 0.28
Breakdown: Gain=0.7 StepCost=0.12 Uncertainty=0.6 Redundancy=0.0
Rationale: "Clear gap exists; tool call likely fills it at
            acceptable cost."
```

## Prescriptive Gate

When the consuming skill's frontmatter sets
`utility_gated: true`, the selected action `a*` is mandatory.
The agent must not substitute a different action regardless
of other heuristics or instructions.
