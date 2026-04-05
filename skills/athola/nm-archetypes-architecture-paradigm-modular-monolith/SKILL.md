---
name: architecture-paradigm-modular-monolith
description: |
  'Single deployable with enforced module boundaries for team autonomy without distributed complexity
version: 1.8.1
triggers:
  - architecture
  - modular-monolith
  - monolith
  - internal-boundaries
  - team-autonomy
  - teams need autonomy without distributed overhead
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Modular Monolith Paradigm


## When To Use

- Organizing large codebases into well-bounded modules
- Teams wanting microservice boundaries without distributed complexity

## When NOT To Use

- Already distributed as microservices
- Tiny applications where module boundaries add unnecessary complexity

## When to Employ This Paradigm
- When you desire team autonomy similar to that of microservices, but without the operational overhead of a distributed system.
- When release velocity is slowed by tangled dependencies between internal modules.
- When a monolithic architecture is simpler to operate today, but there is a clear need to evolve toward a service-based model in the future.

## Adoption Steps
1. **Identify Modules**: Define module boundaries that align with distinct business capabilities or Bounded Contexts from Domain-Driven Design.
2. **Encapsulate Internals**: Use language-level visibility modifiers (e.g., public/private), separate packages, or namespaces to hide the implementation details of each module.
3. **Expose Public Contracts**: Each module should expose its functionality through well-defined facades, APIs, or events. Forbid direct database table access or direct implementation calls between modules.
4. **Enforce Architectural Fitness**: Implement automated tests that fail the build if forbidden dependencies or package references are introduced between modules.
5. **Plan for Evolution**: Continuously track metrics such as change coupling and deployment scope to make informed decisions about if and when to split a module into a separate service.

## Key Deliverables
- An Architecture Decision Record (ADR) that maps module boundaries and defines the rules for any shared code.
- Formal contract documentation (e.g., OpenAPI specs, event schemas) for every interaction point between modules.
- Automated dependency checks and dedicated CI/CD jobs for each module to enforce boundaries.

## Risks & Mitigations
- **Regression to a "Big Ball of Mud"**:
  - **Mitigation**: Without strict enforcement, module boundaries will inevitably erode. Treat any boundary violation as a build-breaking error and maintain a disciplined approach to code reviews.
- **Shared Database Hotspots**:
  - **Mitigation**: High contention on a shared database can become a bottleneck. Introduce clear schema ownership, use view-based access to restrict data visibility, or implement data replication strategies to reduce coupling.
## Troubleshooting

### Common Issues

**Skill not loading**
Check YAML frontmatter syntax and required fields

**Token limits exceeded**
Use progressive disclosure - move details to modules

**Modules not found**
Verify module paths in SKILL.md are correct
