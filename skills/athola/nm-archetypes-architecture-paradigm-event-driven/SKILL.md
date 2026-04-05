---
name: architecture-paradigm-event-driven
description: |
  Apply event-driven async messaging to decouple producers and consumers. Use for real-time processing
version: 1.8.1
triggers:
  - architecture
  - event-driven
  - asynchronous
  - decoupling
  - scalability
  - resilience
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Event-Driven Architecture Paradigm


## When To Use

- Building async, loosely-coupled systems
- Systems with complex event processing pipelines

## When NOT To Use

- Simple request-response applications without async needs
- Systems requiring strong transactional consistency

## When to Employ This Paradigm
- For real-time or bursty workloads (e.g., IoT, financial trading, logistics) where loose coupling and asynchronous processing are beneficial.
- When multiple, distinct subsystems must react to the same business or domain events.
- When system extensibility is a high priority, allowing new components to be added without modifying existing services.

## Adoption Steps
1. **Model the Events**: Define canonical event schemas, establish a clear versioning strategy, and assign ownership for each event type.
2. **Select the Right Topology**: For each data flow, make a deliberate choice between choreography (e.g., a simple pub/sub model) and orchestration (e.g., a central controller or saga orchestrator).
3. **Engineer the Event Platform**: Choose the appropriate event brokers or message meshes. Configure critical parameters such as message ordering, topic partitions, and data retention policies.
4. **Plan for Failure Handling**: Implement production-grade mechanisms for handling message failures, including Dead-Letter Queues (DLQs), automated retry logic, idempotent consumers, and tools for replaying events.
5. **Instrument for Observability**: Implement detailed monitoring to track key metrics such as consumer lag, message throughput, schema validation failures, and the health of individual consumer applications.

## Key Deliverables
- An Architecture Decision Record (ADR) that documents the event taxonomy, the chosen broker technology, and the governance policies (e.g., for naming, versioning, and retention).
- A centralized schema repository with automated CI validation and consumer-driven contract tests.
- Operational dashboards for monitoring system-wide throughput, consumer lag, and DLQ depth.

## Risks & Mitigations
- **Hidden Coupling through Events**:
  - **Mitigation**: Consumers may implicitly depend on undocumented event semantics or data fields. Publish a formal event catalog or schema registry and use linting tools to enforce event structure.
- **Operational Complexity and "Noise"**:
  - **Mitigation**: Without strong observability, diagnosing failed or "stuck" consumers is extremely difficult. Enforce the use of distributed tracing and standardized alerting across all event-driven components.
- **"Event Storming" Analysis Paralysis**:
  - **Mitigation**: While event storming workshops are valuable, they can become unproductive if not properly managed. Keep modeling sessions time-boxed and focused on high-value business contexts first.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
