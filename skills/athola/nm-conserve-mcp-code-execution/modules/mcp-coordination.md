# MCP Subagent Coordination Patterns

> **Version Note (Claude Code 2.1.14+)**: Parallel subagent execution is significantly more stable in Claude Code 2.1.14+, which fixed memory issues that could cause crashes when running parallel subagents. Earlier versions may experience heap out of memory errors with 3+ concurrent agents.

## Pipeline Coordination

Execute subagents in sequence with MECW monitoring:

```python
def coordinate_pipeline_subagents(subagents, input_data):
    """Execute subagents in sequence with MECW monitoring"""

    current_data = input_data
    results = []

    for subagent in subagents:
        # Monitor context before each subagent
        if estimate_context_usage() > get_mecw_limit() * 0.8:
            apply_emergency_compaction()

        # Execute subagent with minimal context
        subagent_result = subagent.execute_focused_task({
            'data': current_data,
            'context_limit': get_mecw_limit() * 0.4
        })

        current_data = subagent_result.get('next_input', current_data)
        results.append(subagent_result)

        # Store intermediate results externally
        store_intermediate_result(subagent.purpose, subagent_result)

    return results
```

### When to Use Pipeline
- **Sequential dependencies**: Each step depends on previous result
- **Linear workflows**: Clear progression from input to output
- **Token conservation**: Share minimal context between steps
- **Error isolation**: Failures don't cascade to all subagents

## Parallel Coordination

Execute multiple subagents simultaneously:

```python
def coordinate_parallel_subagents(subagents, input_data):
    """Execute multiple subagents simultaneously"""

    # Split input data for parallel processing
    data_splits = split_input_for_parallel(input_data, len(subagents))

    # Launch subagents with minimal context
    futures = []
    for subagent, data_split in zip(subagents, data_splits):
        future = subagent.execute_async({
            'data': data_split,
            'context_limit': get_mecw_limit() // len(subagents)
        })
        futures.append(future)

    # Collect results with external storage
    results = []
    for future in futures:
        result = future.get_result()
        store_external_result(result.subagent_id, result.data)
        results.append(result)

    return synthesize_parallel_results(results)
```

### When to Use Parallel
- **Independent tasks**: No dependencies between subagents
- **Time-sensitive**: Need faster completion
- **Resource distribution**: Share MECW budget across subagents
- **Diverse expertise**: Different domains being processed

## Hybrid Coordination

Combine pipeline and parallel patterns:

```python
def coordinate_hybrid_subagents(phase_groups):
    """Execute phases sequentially, subagents within each phase in parallel"""

    all_results = []

    for phase in phase_groups:
        # Execute subagents in this phase in parallel
        phase_results = coordinate_parallel_subagents(
            phase.subagents,
            phase.input_data
        )

        # Synthesize phase results before next phase
        synthesized = synthesize_phase_results(phase_results)
        all_results.append(synthesized)

        # Pass synthesized results to next phase
        if phase.has_next():
            phase.next().set_input_data(synthesized)

    return combine_phase_results(all_results)
```

### When to Use Hybrid
- **Complex workflows**: Mix of sequential and parallel steps
- **Phase dependencies**: Groups of parallel tasks with inter-group dependencies
- **Resource optimization**: Balance speed (parallel) with coordination (sequential)

## Emergency Patterns

### Context Overflow Recovery

```python
def handle_context_overflow(subagent, current_state):
    """Emergency handling when subagent exceeds MECW limits"""

    # 1. Immediately store current state externally
    store_emergency_state(subagent.id, current_state)

    # 2. Split task into smaller sub-subagents
    subtasks = emergency_decompose(current_state.task)

    # 3. Delegate to focused sub-subagents
    subresults = []
    for subtask in subtasks:
        sub_subagent = create_minimal_subagent(
            subtask,
            max_tokens=50  # Ultra-conservative
        )
        subresults.append(sub_subagent.execute())

    # 4. Synthesize minimal summary
    return create_minimal_synthesis(subresults)
```

### Coordination Failure Recovery

```python
def recover_from_coordination_failure(failed_subagent, error):
    """Handle subagent execution failures gracefully"""

    # Log failure for debugging
    log_subagent_failure(failed_subagent.id, error)

    # Attempt recovery strategies
    if error.type == "timeout":
        return retry_with_reduced_scope(failed_subagent)
    elif error.type == "context_overflow":
        return handle_context_overflow(failed_subagent, error.state)
    elif error.type == "validation_failure":
        return skip_and_mark_for_review(failed_subagent)
    else:
        return escalate_to_parent(failed_subagent, error)
```

## Best Practices

### Context Budget Allocation

```python
# Pipeline: Progressive budget allocation
def allocate_pipeline_budgets(subagents, total_budget):
    base_budget = total_budget // len(subagents)
    budgets = []

    for i, subagent in enumerate(subagents):
        # Later stages get slightly more budget for synthesis
        budget = base_budget * (1 + 0.1 * (i / len(subagents)))
        budgets.append(min(budget, total_budget * 0.4))  # Cap at 40%

    return budgets

# Parallel: Equal distribution
def allocate_parallel_budgets(subagents, total_budget):
    return [total_budget // len(subagents)] * len(subagents)
```

### Result Validation

```python
def validate_subagent_results(results):
    """Ensure all subagent results meet quality standards"""

    for result in results:
        # Check MECW compliance
        if result.tokens_used > result.allocated_budget:
            raise MecwViolation(f"{result.id} exceeded budget")

        # Validate external storage
        if not verify_external_storage(result.external_location):
            raise StorageFailure(f"Missing external data for {result.id}")

        # Check result completeness
        if result.status != "completed":
            log_incomplete_result(result)

    return True
```

## Monitoring & Debugging

### Coordination Metrics

```python
def track_coordination_metrics(coordination_session):
    return {
        'total_subagents': len(coordination_session.subagents),
        'parallel_groups': count_parallel_groups(coordination_session),
        'pipeline_depth': calculate_pipeline_depth(coordination_session),
        'context_efficiency': calculate_context_efficiency(coordination_session),
        'failure_rate': coordination_session.failures / coordination_session.total,
        'average_subagent_time': calculate_average_time(coordination_session)
    }
```

### Debug Logging

```python
def log_coordination_event(event_type, subagent_id, details):
    """Structured logging for debugging coordination issues"""

    log_entry = {
        'timestamp': datetime.now().isoformat(),
        'event': event_type,
        'subagent': subagent_id,
        'details': details,
        'context_snapshot': capture_context_state()
    }

    append_to_coordination_log(log_entry)
```
