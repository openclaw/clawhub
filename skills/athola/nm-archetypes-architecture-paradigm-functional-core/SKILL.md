---
name: architecture-paradigm-functional-core
description: |
  Functional Core, Imperative Shell: isolate deterministic logic from side effects for testability
version: 1.8.1
triggers:
  - architecture
  - functional-core
  - imperative-shell
  - testability
  - business-logic
  - side-effects
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Functional Core, Imperative Shell Paradigm


## When To Use

- Separating pure business logic from side effects
- Improving testability through immutable domain models

## When NOT To Use

- Performance-critical hot paths where immutability overhead matters
- Purely imperative codebases with no plans to adopt functional patterns

## When to Employ This Paradigm
- When business logic is entangled with I/O operations (e.g., database calls, HTTP requests), making tests brittle and slow.
- When significant development time is spent rewriting adapters or dealing with framework churn.
- When you require a suite of fast, deterministic unit tests that operate on plain data, complemented by a thin integration testing layer.

## Adoption Steps
1. **Inventory Side Effects**: Create a map of all side effects in the system, such as database writes, external API calls, UI events, and filesystem access. Explicitly assign these responsibilities to the "shell."
2. **Model the Core Logic**: Represent business rules and policies as pure functions. These functions should take domain data as input and return decisions or commands as output, avoiding shared mutable state.
3. **Design the Command Schema**: Define a small, explicit set of command objects that the core can return and the shell can interpret (e.g., `PersistOrder`, `PublishEvent`, `NotifyUser`).
4. **Refactor Incrementally**: Begin with high-churn or critical modules. Wrap legacy imperative code behind adapters while progressively extracting pure calculations into the functional core.
5. **Enforce Boundaries**: Use code reviews and automated architecture tests to validate a strict separation. The shell should only handle orchestration, sequencing, and retries, while the core should never call directly into frameworks or I/O libraries.

## Key Deliverables
- An Architecture Decision Record (ADR) detailing why this pattern was chosen, which modules are affected, and the scope of the migration.
- A suite of unit tests for the core with high (>90%) and deterministic code coverage. Where applicable, use property-based or fixture-based testing to cover a wide range of inputs.
- A suite of contract and integration tests for the shell that verify correct command interpretation, retry logic, and telemetry.
- A set of rollout metrics (e.g., deployment lead time, incident rate in the shell layer) to demonstrate the value of the architectural change.

## Risks & Mitigations
- **Logic Drifting Between Core and Shell**:
  - **Mitigation**: It's common for business logic to accidentally be duplicated or placed in the shell. Enforce a "core owns all decisions" checklist during code reviews to prevent this.
- **Mismatch with Frameworks**:
  - **Mitigation**: The imperative shell may still need to interact with framework-specific lifecycle hooks. Before committing to a large rewrite, build small proof-of-concept adapters to validate the integration strategy.
- **Team Unfamiliarity with the Pattern**:
  - **Mitigation**: Introduce the pattern using pair programming and internal "brown-bag" learning sessions. Document common anti-patterns that are discovered during the pilot phase to guide future development.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
