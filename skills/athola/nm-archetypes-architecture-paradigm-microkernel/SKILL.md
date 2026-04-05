---
name: architecture-paradigm-microkernel
description: |
  Microkernel architecture with a minimal core and plugin-based extensibility for platforms
version: 1.8.1
triggers:
  - architecture
  - microkernel
  - plugin
  - extensibility
  - platform-design
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Microkernel (Plugin) Architecture Paradigm


## When To Use

- Building extensible systems with plugin architectures
- Products requiring customer-specific customizations

## When NOT To Use

- Monolithic applications without plugin extensibility needs
- Systems where all features are core and tightly coupled by design

## When to Employ This Paradigm
- When building platforms, Integrated Development Environments (IDEs), data ingestion pipelines, or marketplaces where third parties need to extend core functionality.
- When the core system requires extreme stability, while extensions and features must evolve and change rapidly.
- When isolating optional dependencies and sandboxing untrusted code provided by plugins is critical.

## Adoption Steps
1. **Define Core Services**: Clearly delineate the minimal responsibilities of the microkernel, such as scheduling, component lifecycle management, core domain primitives, and messaging.
2. **Specify the Plugin Contract**: Design and document the formal contract for all plugins, including registration procedures, capability descriptors, lifecycle hooks (e.g., start, stop), and the permission model.
3. **Build the Extension Loader and Sandbox**: Implement the mechanisms for loading extensions, performing version compatibility checks, negotiating capabilities, and isolating plugins to prevent failures from cascading.
4. **Provide a Software Development Kit (SDK)**: To facilitate plugin development, provide an SDK with project templates, testing harnesses, and compatibility-checking tools.
5. **Govern the Release Process**: Maintain a clear compatibility matrix between core and plugin versions. Implement an automated regression test suite that validates core functionality against a variety of plugins.

## Key Deliverables
- An Architecture Decision Record (ADR) describing the division of responsibilities between the core and plugins, along with the governance model for plugin development and certification.
- Formal documentation for the security and permission model, detailing what capabilities are available to plugins.
- An automated plugin validation pipeline that performs linting, runs tests, and executes the plugin within a sandbox environment.

## Risks & Mitigations
- **Uncontrolled Plugin Proliferation**:
  - **Mitigation**: Without a curation process, the maintenance cost of supporting numerous plugins can become unsustainable. Enforce a formal certification process or a marketplace-style review for all third-party plugins.
- **Version Skew Between Core and Plugins**:
  - **Mitigation**: Use semantic versioning (SemVer) rigorously for both the core and the plugins. Where necessary, provide abstraction layers or "shims" to maintain backward compatibility with older plugins.
- **Core System Bloat**:
  - **Mitigation**: There is often pressure to add feature logic to the stable core. Aggressively resist this temptation. The core should remain minimal, with new features implemented as plugins whenever possible.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
