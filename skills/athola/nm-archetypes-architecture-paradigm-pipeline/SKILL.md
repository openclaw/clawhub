---
name: architecture-paradigm-pipeline
description: Design pipes-and-filters for sequential data transformations
version: 1.8.1
triggers:
  - architecture
  - pipeline
  - pipes-filters
  - ETL
  - streaming
  - data-processing
  - data flows through processing stages
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Pipeline (Pipes and Filters) Paradigm

## When to Employ This Paradigm
- When data must flow through a fixed sequence of discrete transformations, such as in ETL jobs, streaming analytics, or CI/CD pipelines.
- When reusing individual processing stages is needed, either independently or to scale bottleneck stages separately from others.
- When failure isolation between stages is a critical requirement.

## Adoption Steps
1. **Define Filters**: Design each stage (filter) to perform a single, well-defined transformation. Each filter must have a clear input and output data schema.
2. **Connect via Pipes**: Connect the filters using "pipes," which can be implemented as streams, message queues, or in-memory channels. validate these pipes support back-pressure and buffering.
3. **Maintain Stateless Filters**: Where possible, design filters to be stateless. Any required state should be persisted externally or managed at the boundaries of the pipeline.
4. **Instrument Each Stage**: Implement monitoring for each filter to track key metrics such as latency, throughput, and error rates.
5. **Orchestrate Deployments**: Design the deployment strategy to allow each stage to be scaled horizontally and upgraded independently.

## Key Deliverables
- An Architecture Decision Record (ADR) documenting the filters, the chosen pipe technology, the error-handling strategy, and the tools for replaying data.
- A suite of contract tests for each filter, plus integration tests that cover representative end-to-end pipeline executions.
- Observability dashboards that visualize stage-level Key Performance Indicators (KPIs).

## Risks & Mitigations
- **Single-Stage Bottlenecks**:
  - **Mitigation**: Implement auto-scaling for individual filters. If a single filter remains a bottleneck, consider refactoring it into a more granular sub-pipeline.
- **Schema Drift Between Stages**:
  - **Mitigation**: Centralize schema definitions in a shared repository and enforce compatibility tests as part of the CI/CD process to prevent breaking changes.
- **Back-Pressure Failures**:
  - **Mitigation**: Conduct rigorous load testing to simulate high-volume scenarios. Validate that buffering, retry logic, and back-pressure mechanisms behave as expected under stress.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
