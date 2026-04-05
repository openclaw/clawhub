---
name: architecture-paradigm-service-based
description: |
  Design coarse-grained service architecture for deployment independence without microservices complexity and overhead
version: 1.8.1
triggers:
  - architecture
  - service-based
  - soa
  - modular
  - shared-database
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Service-Based Architecture Paradigm


## When To Use

- Multi-team organizations with domain-aligned services
- Systems requiring independent deployment of components

## When NOT To Use

- Single-team projects small enough for a monolith
- Latency-sensitive systems where inter-service calls are prohibitive

## When to Employ This Paradigm
- When teams require a degree of deployment independence but are not yet prepared for the complexity of managing numerous microservices.
- When shared databases or large-scale systems (like ERPs) make full service autonomy unrealistic.
- When establishing clear service contracts for partner teams or external consumers.

## Adoption Steps
1. **Group Capabilities**: Bundle related business functions into a small set of well-defined services, each with a designated owner.
2. **Define Service Contracts**: Publish formal specifications using standards like OpenAPI or AsyncAPI, including Service Level Agreements (SLAs) and a clear versioning strategy.
3. **Control Database Schemas**: Even when services share a database, assign explicit ownership for each schema or table. Gate all breaking changes through a formal review process.
4. **Establish Service Mediation**: Use a service registry or an API gateway to handle routing, authentication, and observability.
5. **Plan for Evolution**: Identify architectural "hotspots" that are likely candidates for being split into more granular services in the future.

## Key Deliverables
- An Architecture Decision Record (ADR) that outlines service boundaries, data ownership rules, and coordination mechanisms.
- A suite of contract tests and consumer-driven contract tests for each service to validate stability.
- Runbooks that describe deployment procedures, rollback plans, and service dependencies.

## Risks & Mitigations
- **Coupling Through a Shared Database**:
  - **Mitigation**: Changes to a shared database can have cascading effects across services. Mitigate this by using database views, replication, or a formal schema deprecation schedule to manage change.
- **Architectural Degradation**:
  - **Mitigation**: Without strong governance, this architecture can degrade into a "distributed monolith"—a monolith with the added complexity of network hops. Track coupling metrics closely and enforce strict ownership of services and data to prevent this.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
