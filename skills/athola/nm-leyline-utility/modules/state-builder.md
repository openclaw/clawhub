# State Builder

Constructs the state representation that feeds all four utility scorers.
The state object is populated once per evaluation session and passed
unchanged to each scorer.

## Scope Selection

| Scope | Who decides | When to use |
|-------|-------------|-------------|
| self | A skill deciding its own next action | Default for any skill mid-execution |
| subagent | A subagent evaluating its own loop | Subagents dispatched with a specific task |
| dispatch | A parent orchestrating subagents | Before launching agent N+1 |

## State Template

```yaml
state:
  scope: "self"            # self | subagent | dispatch

  # Static context
  query: ""                # Original user request
  action_space: []         # Available actions for this consumer
  budget:
    max_steps: 10
    token_ceiling: null
    model_tier: "opus"

  # Dynamic context
  step: 0
  actions_taken: []        # [{action, target, step, tokens_used}]
  observations: []         # Results from retrieve/tool_call/verify
  evidence_count: 0
  tokens_spent: 0

  # Task context (from TaskList)
  tasks:
    total: 0
    completed: 0
    in_progress: 0
    pending: 0
    current_task_id: null
    completion_ratio: 0.0

  # Dispatch-only fields
  agents: []               # [{agent_id, type, scope, tokens_used, status, findings_count}]
  agents_pending: 0
  agents_completed: 0
  total_agent_tokens: 0
  coordination_overhead: 0.0

  # Derived signals
  budget_remaining_ratio: 1.0
  action_diversity: 0.0
  retrieval_coverage: 0.0
```

## Scope Transition Rules

Scope is fixed per evaluation session.
A skill in `self` scope that decides to delegate starts a new evaluation
in `dispatch` scope.
Dispatch-only fields initialize to zero for non-dispatch scopes.
The parent's `self` state is preserved after dispatch completes.

## Observable vs Estimated

| Signal | Source |
|--------|--------|
| step, tokens_spent, actions_taken | Observable |
| evidence_count, agents list | Observable |
| retrieval_coverage | LLM-estimated |
| task counts | Observable (TaskList) |

## Construction Instructions

Populate state from available context in this order:

1. **Step count and actions_taken**: Read from conversation history.
   Count tool calls made since the task began.
2. **Task counts**: Pull from TaskList (total, completed, in_progress,
   pending). Compute `completion_ratio = completed / total` (or 0.0
   if total is 0).
3. **tokens_spent**: Use session token counter if available; otherwise
   estimate from message lengths.
4. **budget_remaining_ratio**: Compute as
   `(max_steps - step) / max_steps`, clamped to [0.0, 1.0].
5. **retrieval_coverage**: Estimate as files read divided by estimated
   relevant files.
   Use 0.5 as the default when total scope is unknown.
6. **action_diversity**: Count distinct action types in `actions_taken`
   divided by total actions taken.
7. **Dispatch scope only**: Populate `agents` list from dispatched
   agent results.
   Set `agents_pending` and `agents_completed` from agent statuses.
   Sum `total_agent_tokens` from each agent's `tokens_used`.

## Subagent Constraints

Subagents cannot access the parent's TaskList.
Task context for subagents comes from the dispatch prompt, not from
TaskList directly.
Populate `tasks.total` and `tasks.completed` from explicit counts
provided in the dispatch instructions.
If no task counts are provided, leave all task fields at their zero
defaults and rely on step-based signals instead.
