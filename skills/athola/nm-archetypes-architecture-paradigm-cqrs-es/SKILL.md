---
name: architecture-paradigm-cqrs-es
description: Apply CQRS and Event Sourcing for read/write separation and audit trails
version: 1.8.1
triggers:
  - architecture
  - CQRS
  - Event-Sourcing
  - distributed-systems
  - audit-trail
  - scalability
  - auditability is critical
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The CQRS and Event Sourcing Paradigm


## When To Use

- Designing event-sourced systems with complex domain logic
- Systems requiring full audit trails of state changes

## When NOT To Use

- Simple CRUD applications without complex domain logic
- Small projects where event sourcing adds unnecessary complexity

## When to Employ This Paradigm
- When read and write workloads have vastly different performance characteristics or scaling requirements.
- When all business events must be captured in a durable, immutable history or audit trail.
- When a business needs to rebuild projections of data or support temporal queries (e.g., "What did the state of this entity look like yesterday?").

## Adoption Steps
1. **Identify Aggregates**: Following Domain-Driven Design principles, specify the bounded contexts and the business invariants that each command must enforce on an aggregate.
2. **Model Commands and Events**: Define the schemas and validation rules for all commands and the events they produce. Document a clear strategy for versioning and schema evolution.
3. **Implement the Write Side (Command Side)**: Command handlers are responsible for loading an aggregate's event stream, executing business logic, and atomically appending new events to the stream.
4. **Build Projections to the Read Side**: Create separate read models (projections) that are fed by subscriptions to the event stream. Implement back-pressure and retry policies for these subscriptions.
5. **validate Full Observability**: Implement detailed logging that includes event IDs, sequence numbers, and metrics for tracking the lag time of each projection.

## Key Deliverables
- An Architecture Decision Record (ADR) detailing the aggregates, the chosen event store technology, the projection strategy, and the expected data consistency model (e.g., eventual consistency SLAs).
- A suite of tests for command handlers that use in-memory event streams, complemented by integration tests for the projections.
- Operational tooling for replaying events, taking state snapshots for performance, and managing schema migrations.

## Risks & Mitigations
- **High Operational Overhead**:
  - **Mitigation**: Bugs related to event ordering and replays can be difficult to diagnose. Invest heavily in automation, Dead-Letter Queues (DLQs) for failed events, and regular "chaos engineering" drills to test resilience.
- **Challenges of Eventual Consistency**:
  - **Mitigation**: Users may be confused by delays between performing an action and seeing the result. Clearly document the SLAs for read model updates and manage user-facing expectations accordingly, for example, by providing immediate feedback on the command side.
- **Schema Drift**:
  - **Mitigation**: An unplanned change to an event schema can break consumers. Enforce the use of a formal schema registry and implement version gates in the CI/CD pipeline to prevent the emission of unvalidated event versions.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
