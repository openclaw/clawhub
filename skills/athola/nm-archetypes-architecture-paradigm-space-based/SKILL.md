---
name: architecture-paradigm-space-based
description: |
  Apply data-grid architecture for high-traffic stateful workloads with in-memory processing and linear scalability
version: 1.8.1
triggers:
  - architecture
  - space-based
  - data-grid
  - scalability
  - in-memory
  - stateful
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Space-Based Architecture Paradigm


## When To Use

- High-traffic applications needing elastic scalability
- Systems requiring in-memory data grids

## When NOT To Use

- Low-traffic applications where distributed caching is overkill
- Systems with strong consistency requirements over availability

## When to Employ This Paradigm
- When traffic or state volume overwhelms a single database node.
- When latency requirements demand in-memory data grids located close to processing units.
- When linear scalability is required, achieved by partitioning workloads across many identical, self-sufficient units.

## Adoption Steps
1. **Partition Workloads**: Divide traffic and data into processing units, each backed by a replicated data cache.
2. **Design the Data Grid**: Select the appropriate caching technology, replication strategy (synchronous vs. asynchronous), and data eviction policies.
3. **Coordinate Persistence**: Implement a write-through or write-behind strategy to a durable data store, including reconciliation processes.
4. **Implement Failover Handling**: Design a mechanism for leader election or heartbeats to validate recovery from node loss without data loss.
5. **Validate Scalability**: Conduct load and chaos testing to confirm the system's elasticity and self-healing capabilities.

## Key Deliverables
- An Architecture Decision Record (ADR) detailing the chosen grid technology, partitioning scheme, and durability strategy.
- Runbooks for scaling processing units and for recovering from "split-brain" scenarios.
- A monitoring suite to track cache hit rates, replication lag, and failover events.

## Risks & Mitigations
- **Eventual Consistency Issues**:
  - **Mitigation**: Formally document data-freshness Service Level Agreements (SLAs) and implement compensation logic for data that is not immediately consistent.
- **Operational Complexity**:
  - **Mitigation**: The orchestration of a data grid requires mature automation. Invest in production-grade tooling and automation early in the process.
- **Cost**:
  - **Mitigation**: In-memory grids can be resource-intensive. Implement aggressive monitoring of utilization and auto-scaling policies to manage costs effectively.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
