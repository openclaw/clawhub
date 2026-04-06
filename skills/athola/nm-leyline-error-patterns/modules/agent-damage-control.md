# Agent Damage Control

Agent-level error recovery patterns for multi-agent coordination. Maps service-level error categories to agent-level equivalents and defines escalation ladders.

## Error Categories

Agent-level error categories extend the service-level taxonomy from error-patterns:

| Agent Category | Service Equivalent | Severity | Recovery |
|----------------|-------------------|----------|----------|
| **AGENT_CRASH** | PERMANENT | Critical | Replace agent, reassign tasks |
| **CONTEXT_OVERFLOW** | RESOURCE | Error | Graceful handoff, context shed |
| **MERGE_CONFLICT** | TRANSIENT | Warning | Stop, resolve, resume |
| **PARTIAL_FAILURE** | Mixed | Varies | Triage by sub-category |

## Escalation Ladder

Three-tier escalation with clear handoff points:

```
Tier 1: Agent Self-Recovery
  Agent detects issue, attempts automated recovery
  (retry, context shed, conflict resolution)
        |
        | Fails after 2 attempts
        v
Tier 2: Lead Agent Intervention
  Lead reassigns tasks, spawns replacement agents,
  coordinates resolution across team
        |
        | Cannot resolve or CRITICAL severity
        v
Tier 3: Human Escalation
  Human notified with full context, recommended actions,
  and current state summary
```

## Quick Reference

| Scenario | First Action |
|----------|--------------|
| Agent stops responding | Check heartbeat, reassign tasks |
| Response truncation | Summarize state, create continuation |
| File conflicts after parallel work | Stop agents, lead resolves |
| Some tasks fail, others succeed | Triage by error category |

## Recovery Patterns

### Agent Crash Recovery
- Detect orphaned tasks via heartbeat monitoring
- Apply "replace don't wait" doctrine: spawn new agent immediately
- Recover state from last checkpoint or committed work
- Reassign orphaned tasks to replacement agent

### Context Overflow Handling
- Detection signals: truncated responses, repeated content, loss of coherence
- Graceful handoff: summarize state, write to file, spawn continuation
- Progressive context shedding: drop least-relevant loaded modules first

### Merge Conflict Resolution
- Stop all agents working on conflicting files
- Lead agent resolves conflicts using diff analysis
- Resume agents with updated base after resolution
- Prevention: assign non-overlapping file scopes

### Partial Failure Handling
- Triage: categorize each sub-task result (success/failure/partial)
- Salvage: commit successful work first
- Retry: attempt failed tasks with fresh context
- Report: document what succeeded and what needs manual attention

## Integration

Reference specific recovery patterns from orchestrator skills:
```markdown
On agent crash: follow leyline:error-patterns/modules/agent-damage-control.md
```

## Exit Criteria

- Failed agent identified and replaced (or escalated)
- Orphaned tasks reassigned to healthy agents
- Successful work preserved and committed
- Recovery actions logged for post-mortem
