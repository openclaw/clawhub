---
name: retry-protocol
description: |
  Protocol for retrying agent work when output contract
  validation fails. Provides specific feedback rather
  than wholesale re-dispatch.
category: evidence-gating
---

# Retry Protocol

When an agent's output fails contract validation, retry
with specific feedback instead of re-dispatching from
scratch.

## How It Works

1. Agent completes work and writes findings file
2. Contract validator runs (see `output-contracts.md`)
3. If PASS: accept findings, continue workflow
4. If FAIL: generate retry prompt from validation result

## Retry Prompt Template

The retry prompt combines the validation feedback with
the original task:

```markdown
## Contract Validation Failed -- Retry Required

{validator.retry_feedback() output}

## Original Task (unchanged)

{original dispatch prompt}

## Instructions

Fix ONLY the issues listed above.
Do not redo work that already meets the contract.
This is retry {N} of {retry_budget}.
```

## Retry Budget

Each output contract specifies a `retry_budget`
(default: 2).

- Retry 1: Agent gets specific feedback, retries.
- Retry 2: Agent gets updated feedback, retries.
- Budget exhausted: Failure escalated to parent with
  full validation detail.

## Escalation on Budget Exhaustion

When retries are exhausted, the parent receives:

```markdown
## Agent Failed Contract Validation

Agent: {agent-name}
Task: {original task summary}
Retries attempted: {retry_budget}

### Last Validation Result

{final validation detail}

### Recommendation

The agent could not meet the output contract after
{retry_budget} retries. Options:
1. Adjust the contract (lower evidence threshold)
2. Assign to a different agent with more context
3. Split the task into smaller pieces
4. Escalate for human review
```

## Key Principles

- **Specific over generic**: Retry feedback names
  exact missing elements, not "try harder."
- **Preserve prior work**: The retry prompt tells the
  agent not to redo passing sections.
- **Bounded attempts**: The retry budget prevents
  infinite loops.
- **Transparent failure**: When budget is exhausted,
  the parent gets full context to make a decision.
