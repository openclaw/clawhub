---
name: knowledge-locator
description: |
  Search and navigate stored knowledge in memory palaces. Use for cross-referencing, context retrieval
version: 1.8.1
triggers:
  - retrieval
  - search
  - indexing
  - recall
  - spatial-memory
  - pr-review
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.memory-palace-architect", "night-market.review-chamber"]}}}
source: claude-night-market
source_plugin: memory-palace
---

> **Night Market Skill** — ported from [claude-night-market/memory-palace](https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [What It Is](#what-it-is)
- [Quick Start](#quick-start)
- [Search Palaces](#search-palaces)
- [List All Palaces](#list-all-palaces)
- [When to Use](#when-to-use)
- [Search Modalities](#search-modalities)
- [Core Workflow](#core-workflow)
- [Target Metrics](#target-metrics)
- [Detailed Resources](#detailed-resources)
- [PR Review Search](#pr-review-search)
- [Quick Commands](#quick-commands)
- [Review Chamber Rooms](#review-chamber-rooms)
- [Context-Aware Surfacing](#context-aware-surfacing)
- [Integration](#integration)


# Knowledge Locator

A spatial indexing and retrieval system for finding information within and across memory palaces. Enables multi-modal search using spatial, semantic, sensory, and associative queries.

## What It Is

The Knowledge Locator provides efficient information retrieval across your memory palace network by:
- Building and maintaining spatial indices for fast lookup
- Supporting multiple search modalities (spatial, semantic, sensory)
- Mapping cross-references between palaces
- Tracking access patterns for optimization

## Quick Start

### Search Palaces
```bash
python scripts/palace_manager.py search "authentication" --type semantic
```
**Verification:** Run `python --version` to verify Python environment.

### List All Palaces
```bash
python scripts/palace_manager.py list
```
**Verification:** Run `python --version` to verify Python environment.

## When To Use

- Finding specific concepts within one or more memory palaces
- Cross-referencing information across different palaces
- Discovering connections between stored information
- Finding information using partial or contextual queries
- Analyzing access patterns for palace optimization

## When NOT To Use

- Creating new
  palace structures - use memory-palace-architect
- Processing new
  external resources - use knowledge-intake
- Creating new
  palace structures - use memory-palace-architect
- Processing new
  external resources - use knowledge-intake

## Search Modalities

| Mode | Description | Best For |
|------|-------------|----------|
| **Spatial** | Query by location path | "Find concepts in the Workshop" |
| **Semantic** | Search by meaning/keywords | "Find authentication-related items" |
| **Sensory** | Locate by sensory attributes | "Blue-colored concepts" |
| **Associative** | Follow connection chains | "Related to OAuth" |
| **Temporal** | Find by creation/access date | "Recently accessed" |

## Core Workflow

1. **Build Index** - Create spatial index of all palaces
2. **Optimize Search** - Configure search strategies and heuristics
3. **Map Cross-References** - Identify inter-palace connections
4. **Test Retrieval** - Validate search accuracy and speed
5. **Analyze Patterns** - Track and optimize based on usage

## Target Metrics

- **Retrieval latency**: ≤ 150ms cached, ≤ 500ms cold
- **Top-3 accuracy**: ≥ 90% for semantic queries
- **Robustness**: ≥ 80% success with incomplete queries

## Detailed Resources

- **Index Structure**: See `modules/index-structure.md`
- **Search Strategies**: See `modules/search-strategies.md`
- **Cross-Reference Mapping**: See `modules/index-structure.md`

## PR Review Search

Search the review chamber within project palaces for past decisions and patterns.

### Quick Commands

```bash
# Search review chamber by query
python scripts/palace_manager.py search "authentication" \
  --palace <project_id> \
  --room review-chamber

# List entries in specific room
python scripts/palace_manager.py list-reviews \
  --palace <project_id> \
  --room decisions

# Find by tags
python scripts/palace_manager.py search-reviews \
  --tags security,api \
  --since 2025-01-01
```
**Verification:** Run `python --version` to verify Python environment.

### Review Chamber Rooms

| Room | Content | Example Query |
|------|---------|---------------|
| `decisions/` | Architectural choices | "JWT vs sessions" |
| `patterns/` | Recurring solutions | "error handling pattern" |
| `standards/` | Quality conventions | "API error format" |
| `lessons/` | Post-mortems | "outage learnings" |

### Context-Aware Surfacing

When starting work in a code area, surface relevant review knowledge:

```bash
# When in auth/ directory
python scripts/palace_manager.py context-search auth/

# Returns:
# - Past decisions about authentication
# - Known patterns in this area
# - Relevant standards to follow
```
**Verification:** Run `python --version` to verify Python environment.

## Integration

Works with:
- `memory-palace-architect` - Indexes palaces created by architect
- `session-palace-builder` - Searches session-specific palaces
- `digital-garden-cultivator` - Finds garden content and links
- `review-chamber` - Searches PR review knowledge in project palaces
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
