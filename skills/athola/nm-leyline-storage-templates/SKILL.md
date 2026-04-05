---
name: storage-templates
description: Consult this skill when designing storage and documentation systems
version: 1.8.1
triggers:
  - templates
  - storage
  - lifecycle
  - maturity
  - organization
  - patterns
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Core Concepts](#core-concepts)
- [Template Types](#template-types)
- [Maturity Lifecycle](#maturity-lifecycle)
- [Quick Start](#quick-start)
- [Basic Template Structure](#basic-template-structure)
- [Core Content](#core-content)
- [Metadata](#metadata)
- [File Naming Conventions](#file-naming-conventions)
- [Domain Applications](#domain-applications)
- [Common Patterns](#common-patterns)
- [Promotion Workflow](#promotion-workflow)
- [Template Selection Guide](#template-selection-guide)
- [Integration Pattern](#integration-pattern)
- [Detailed Resources](#detailed-resources)
- [Exit Criteria](#exit-criteria)


# Storage Templates

## Overview

Generic template patterns and lifecycle management for structured content storage. Provides reusable templates, maturity progression models, and file naming conventions that work across different storage domains.

## When To Use

- Building knowledge management systems
- Organizing documentation with maturity stages
- Need consistent file naming patterns
- Want template-driven content creation
- Implementing lifecycle-based workflows

## When NOT To Use

- Simple storage without lifecycle or structure needs

## Core Concepts

### Template Types

| Type | Purpose | Maturity | Lifetime |
|------|---------|----------|----------|
| **Evergreen** | Stable, proven knowledge | High | Permanent |
| **Growing** | Active development | Medium | 1-3 months |
| **Seedling** | Early ideas | Low | 1-2 weeks |
| **Reference** | Tool/version-specific | N/A | Until deprecated |

### Maturity Lifecycle

```
seedling → growing → evergreen → archive
    ↓         ↓          ↓           ↓
 1-2 weeks  1-3 months  permanent  deprecated
```
**Verification:** Run the command with `--help` flag to verify availability.

## Quick Start

### Basic Template Structure

```yaml
---
title: [Content Title]
created: [YYYY-MM-DD]
maturity: seedling|growing|evergreen|reference
tags: [relevant, tags]
---

# [Title]

## Core Content
[Main information]

## Metadata
[Context and attribution]
```
**Verification:** Run the command with `--help` flag to verify availability.

### File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Evergreen | `topic-name.md` | `functional-core-pattern.md` |
| Growing | `topic-name.md` | `async-patterns.md` |
| Seedling | `YYYY-MM-DD-topic.md` | `2025-12-05-template-idea.md` |
| Reference | `tool-version.md` | `python-3.12-features.md` |

### Domain Applications

Add domain-specific fields to templates:
- **memory-palace**: `palace`, `district` for knowledge organization
- **sanctum**: `scope`, `version` for commit templates
- **spec-kit**: `phase`, `status` for specifications

See `modules/template-patterns.md` for detailed examples.

## Common Patterns

### Promotion Workflow

**Seedling → Growing**:
- Accessed more than once
- Connected to other entries
- Expanded with new insights

**Growing → Evergreen**:
- Proven useful over 3+ months
- Stable, not frequently edited
- Well-connected in system

**Evergreen → Archive**:
- Superseded by newer knowledge
- Technology/approach deprecated
- No longer applicable

### Template Selection Guide

| Stability | Purpose | Template |
|-----------|---------|----------|
| Proven | Long-term | Evergreen |
| Evolving | Active development | Growing |
| Experimental | Exploration | Seedling |
| Versioned | External reference | Reference |

## Integration Pattern

```yaml
# In your skill's frontmatter
dependencies: [leyline:storage-templates]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Detailed Resources

- **Templates**: See `modules/template-patterns.md` for detailed structures
- **Lifecycle**: See `modules/lifecycle-stages.md` for maturity progression

## Exit Criteria

- Template selected for use case
- File naming convention applied
- Maturity stage assigned
- Promotion criteria understood
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
