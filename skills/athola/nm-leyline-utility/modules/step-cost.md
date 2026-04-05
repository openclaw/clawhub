# Step Cost

StepCost is an observable cost proxy that increases as budget depletes.
It is not a direct measurement of tokens or latency, but a lightweight
control signal used to discount Gain estimates.

## Formula

```
StepCost(a | s_t) = w1 * step_ratio
                  + w2 * token_ratio
                  + w3 * model_cost_ratio
```

## Component Definitions

**step_ratio** = `current_step / max_steps` (budget burn rate)

**token_ratio** = `estimated_action_tokens / token_ceiling`

Set to 0 when no ceiling is configured; weights renormalize in that
case (see Null Token Ceiling below).

**model_cost_ratio**

| Model  | Ratio |
|--------|-------|
| haiku  | 0.1   |
| sonnet | 0.4   |
| opus   | 1.0   |

External models via `conjure` use delegation-core's own cost
estimation.

## Weight Defaults

| Weight | Default | Null-ceiling renorm |
|--------|---------|---------------------|
| w1     | 0.5     | 0.71                |
| w2     | 0.3     | 0.00                |
| w3     | 0.2     | 0.29                |

## Null Token Ceiling

When `token_ceiling` is null, `token_ratio = 0` and the w2 term drops
out entirely.
Weights renormalize to w1 = 0.71, w3 = 0.29.

## Dispatch-Scope Overhead

For actions in dispatch scope, add a `coordination_overhead` term
derived from Brooks's Law:

| Agent count | Overhead |
|-------------|----------|
| 1-3         | +0.0     |
| 4-5         | +0.1     |
| 6-8         | +0.2     |
| 9+          | +0.3     |

## Worked Example

Step 3 of 10, opus model, no token ceiling:

```
StepCost = 0.71 * (3/10) + 0.29 * 1.0
         = 0.71 * 0.3 + 0.29
         = 0.213 + 0.29
         = 0.503
```

## Design Note

Cost increases as budget depletes: early actions are cheap, late
actions are expensive.
This produces the diminishing-returns curve from the paper's Fig. 4.
