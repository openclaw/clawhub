---
name: architecture-paradigms
description: Interactive selector and router for architecture paradigms
version: 1.8.1
triggers:
  - architecture
  - patterns
  - selection
  - implementation
  - adr
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.architecture-paradigm-functional-core", "night-market.architecture-paradigm-hexagonal", "night-market.architecture-paradigm-cqrs-es", "night-market.architecture-paradigm-event-driven", "night-market.architecture-paradigm-layered", "night-market.architecture-paradigm-modular-monolith", "night-market.architecture-paradigm-microkernel", "night-market.architecture-paradigm-microservices", "night-market.architecture-paradigm-service-based", "night-market.architecture-paradigm-space-based", "night-market.architecture-paradigm-pipeline", "night-market.architecture-paradigm-serverless", "night-market.architecture-paradigm-client-server"]}}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Scenario Router](#quick-scenario-router)
- [3-Step Selection Workflow](#3-step-selection-workflow)
- [Available Paradigm Skills](#available-paradigm-skills)
- [Integration with Other Skills](#integration-with-other-skills)
- [Exit Criteria](#exit-criteria)

# Architecture Paradigm Router

This skill helps you **select** the right architecture paradigm(s) for your system, then **routes** you to the specific paradigm skill for implementation details.

## Quick Scenario Router

Match your needs to the recommended paradigm:

| Your Scenario | Primary Paradigm | Load Skill |
|---------------|------------------|------------|
| **Enterprise app with multiple teams** | Microservices or Modular Monolith | `architecture-paradigm-microservices` or `architecture-paradigm-modular-monolith` |
| **Complex business rules & testing** | Functional Core, Imperative Shell | `architecture-paradigm-functional-core` |
| **Real-time/event processing** | Event-Driven Architecture | `architecture-paradigm-event-driven` |
| **Legacy system modernization** | Hexagonal (Ports & Adapters) | `architecture-paradigm-hexagonal` |
| **Cloud-native/bursty workloads** | Serverless | `architecture-paradigm-serverless` |
| **ETL/data processing pipeline** | Pipeline Architecture | `architecture-paradigm-pipeline` |
| **Simple CRUD app** | Layered Architecture | `architecture-paradigm-layered` |
| **Command/query separation** | CQRS + Event Sourcing | `architecture-paradigm-cqrs-es` |

## 3-Step Selection Workflow

### Step 1: Define Your Needs

**Primary Concerns** (select all that apply):
- **Testability**: Isolate business logic → `functional-core` or `hexagonal`
- **Team Autonomy**: Independent deployment → `microservices` or `modular-monolith`
- **Infrastructure Flexibility**: Swap databases/frameworks → `hexagonal`
- **Real-time Scaling**: Variable loads with events → `event-driven` or `space-based`
- **Simplicity**: Maintainable without complexity → `layered` or `modular-monolith`
- **Legacy Integration**: Work with existing systems → `hexagonal` or `microkernel`

**System Context**:
- **Team Size**: `< 5` → Layered/Functional Core | `5-15` → Modular Monolith | `15-50` → Microservices | `50+` → Microservices/Space-Based
- **Domain Complexity**: `Simple` → Layered | `Moderate` → Hexagonal/Modular Monolith | `Complex` → Functional Core/CQRS | `Highly Complex` → Microservices/Event-Driven

### Step 2: Evaluate Paradigms

Based on your needs from Step 1, review these options:

**For Testability & Business Logic**
- Load `architecture-paradigm-functional-core` - Isolates business logic from infrastructure
- Load `architecture-paradigm-hexagonal` - Clear domain/infrastructure boundaries

**For Team Autonomy**
- Load `architecture-paradigm-microservices` - Independent deployment and scaling
- Load `architecture-paradigm-modular-monolith` - Team autonomy without distributed complexity

**For Infrastructure Flexibility**
- Load `architecture-paradigm-hexagonal` - Swap infrastructure without domain changes

**For Simplicity & Maintainability**
- Load `architecture-paradigm-layered` - Simple, well-understood separation

**For Real-time Event Processing**
- Load `architecture-paradigm-event-driven` - Scalable, decoupled processing
- Load `architecture-paradigm-space-based` - In-memory data grids for linear scalability

**For Legacy Integration**
- Load `architecture-paradigm-microkernel` - Plugin architecture for extensible platforms
- Load `architecture-paradigm-hexagonal` - Adapters for external systems

### Step 3: Load Paradigm Skill for Implementation

Once you've selected your paradigm(s), load the specific skill for detailed guidance:

```bash
# Example: You selected Hexagonal Architecture
Skill(archetypes:architecture-paradigm-hexagonal)
```

The individual paradigm skill provides:
- ✅ Complete implementation guide
- ✅ ADR templates
- ✅ Migration checklist
- ✅ Code examples
- ✅ Testing strategies
- ✅ Risk assessments

## Available Paradigm Skills

| Paradigm | Complexity | Team Size | Best For | Skill Name |
|----------|------------|-----------|----------|------------|
| **Functional Core** | Medium | Small-Large | Complex business logic | `architecture-paradigm-functional-core` |
| **Hexagonal** | Medium | Small-Large | Infrastructure changes | `architecture-paradigm-hexagonal` |
| **Layered** | Low | Small-Medium | Simple domains | `architecture-paradigm-layered` |
| **Modular Monolith** | Medium | Medium-Large | Evolving systems | `architecture-paradigm-modular-monolith` |
| **Microservices** | High | Large | Complex domains | `architecture-paradigm-microservices` |
| **Event-Driven** | High | Medium-Large | Real-time processing | `architecture-paradigm-event-driven` |
| **CQRS + ES** | High | Medium-Large | Audit trails | `architecture-paradigm-cqrs-es` |
| **Service-Based** | Medium | Medium | Coarse-grained services | `architecture-paradigm-service-based` |
| **Serverless** | Medium | Small-Medium | Cloud-native/bursty | `architecture-paradigm-serverless` |
| **Microkernel** | Medium | Small-Medium | Plugin systems | `architecture-paradigm-microkernel` |
| **Space-Based** | High | Large | Linear scalability | `architecture-paradigm-space-based` |
| **Pipeline** | Low | Small-Medium | ETL workflows | `architecture-paradigm-pipeline` |
| **Client-Server** | Low | Small | Traditional apps | `architecture-paradigm-client-server` |

## Integration with Other Skills

- **Architecture Review**: Use this skill first to select paradigms, then `/architecture-review` for evaluation
- **Implementation Planning**: Select paradigms here, then `/writing-plans` for detailed task breakdown
- **Refactoring**: Identify target paradigms here, then use paradigm-specific skills for migration strategies

## Exit Criteria

- [ ] At least one paradigm is selected with clear rationale
- [ ] Specific paradigm skill has been loaded for detailed guidance
- [ ] Ready to create ADR or implementation plan

## Next Steps

1. **Load the specific paradigm skill** - Use `Skill(archetypes:architecture-paradigm-NAME)`
2. **Generate an ADR** - Use the paradigm's ADR templates
3. **Create implementation plan** - Use paradigm's migration checklist
4. **Set up monitoring** - Track success metrics from paradigm guidance
