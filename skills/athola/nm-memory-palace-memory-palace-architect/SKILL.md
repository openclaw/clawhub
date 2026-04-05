---
name: memory-palace-architect
description: Design memory palace structures with spatial layouts and domain org
version: 1.8.1
triggers:
  - memory
  - organization
  - spatial
  - knowledge
  - architecture
  - mnemonic
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace", "emoji": "\ud83c\udfd7\ufe0f", "requires": {"config": ["night-market.leyline:progressive-loading"]}}}
source: claude-night-market
source_plugin: memory-palace
---

> **Night Market Skill** — ported from [claude-night-market/memory-palace](https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [What It Is](#what-it-is)
- [Quick Start](#quick-start)
- [Create a New Palace](#create-a-new-palace)
- [List Existing Palaces](#list-existing-palaces)
- [View Palace Status](#view-palace-status)
- [When to Use](#when-to-use)
- [Architectural Templates](#architectural-templates)
- [Core Workflow](#core-workflow)
- [Detailed Resources](#detailed-resources)
- [Integration](#integration)
- [Expected Outputs](#expected-outputs)


# Memory Palace Architect

Design and construct virtual memory palaces for spatial knowledge organization. This skill guides you through creating memorable spatial structures that enhance recall and organize complex information.

## What It Is

A memory palace is a mnemonic technique that uses spatial visualization to organize and recall information. This skill provides a systematic approach for:
- Analyzing knowledge domains for optimal spatial mapping
- Designing architectural layouts that reflect conceptual relationships
- Creating multi-sensory associations for enhanced recall
- Building navigable structures for knowledge retrieval

## Quick Start

### Create a New Palace
```bash
python scripts/palace_manager.py create "My Palace" "programming" --metaphor workshop
```
**Verification:** Run `python --version` to verify Python environment.

### List Existing Palaces
```bash
python scripts/palace_manager.py list
```
**Verification:** Run `python --version` to verify Python environment.

### View Palace Status
```bash
python scripts/palace_manager.py status
```
**Verification:** Run `python --version` to verify Python environment.

## When To Use

- Creating knowledge structures for complex topics
- Organizing large amounts of related information
- Building persistent, project-specific memory systems
- Designing learning pathways for skill acquisition
- Structuring documentation or reference material

## When NOT To Use

- Quick knowledge search
  - use knowledge-locator instead
- Session-specific context - use
  session-palace-builder
- Quick knowledge search
  - use knowledge-locator instead
- Session-specific context - use
  session-palace-builder

## Architectural Templates

| Template | Best For | Key Features |
|----------|----------|--------------|
| **Fortress** | Security, defense, production-grade systems | Strong boundaries, layered access |
| **Library** | Knowledge, research, documentation | Organized shelves, categorized sections |
| **Workshop** | Practical skills, tools, techniques | Workbenches, tool areas, project spaces |
| **Garden** | Organic growth, evolving knowledge | Plots, seasons, interconnected paths |
| **Observatory** | Exploration, discovery, patterns | Viewing platforms, star maps, instruments |

## Core Workflow

1. **Analyze Domain** - Identify concepts, relationships, and hierarchy
2. **Design Layout** - Choose metaphor and spatial organization
3. **Map Associations** - Create memorable imagery and connections
4. **Encode Details** - Add sensory attributes and ambient atmosphere
5. **Validate Palace** - Test recall efficiency and navigation

## Detailed Resources

- **Domain Analysis Guide**: See `modules/domain-analysis.md`
- **Layout Patterns**: See `modules/layout-patterns.md`
- **Sensory Encoding**: See `modules/sensory-encoding.md`
- **Validation Metrics**: See `modules/validation.md`
- **Franklin Protocol**: See `modules/franklin-protocol.md` - Apply the original learning algorithm to palace design

## Integration

Works with:
- `knowledge-locator` - For searching across palaces
- `session-palace-builder` - For temporary session palaces
- `digital-garden-cultivator` - For evolving knowledge bases

## Expected Outputs

- Complete palace schema with spatial coordinates
- Sensory encoding profile for each location
- Navigation guide and connection map
- Recall testing results and optimization recommendations
## Troubleshooting

### Common Issues

If palace creation fails, check that the `metaphor` argument matches one of the supported templates (Fortress, Library, Workshop, Garden, Observatory). For script errors, ensure the `palace_manager.py` script has executable permissions and that your Python environment meets the requirements listed in `pyproject.toml`.
