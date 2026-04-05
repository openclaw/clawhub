---
name: rules-eval
description: |
  Evaluate and validate Claude Code rules in .claude/rules/ directories. Use for frontmatter, glob patterns, and quality audits
version: 1.8.1
triggers:
  - evaluation
  - rules
  - validation
  - quality-assurance
  - glob-patterns
  - frontmatter
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.skills-eval"]}}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Rules Evaluation Framework

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Evaluation Workflow](#evaluation-workflow)
4. [Scoring](#scoring)
5. [Resources](#resources)

## Overview

This skill evaluates Claude Code rules in `.claude/rules/` directories against quality standards. It validates YAML frontmatter, glob pattern syntax, content quality, and directory organization. Rules files support path-scoped conditional loading via `paths` frontmatter and unconditional rules (no `paths` field).

Key validations: YAML syntax errors, unquoted glob patterns, Cursor-specific fields (`alwaysApply`, `globs`), overly broad patterns, content verbosity, and naming conventions.

## Quick Start

```bash
# Evaluate rules in current project
/rules-eval

# Evaluate specific directory
/rules-eval .claude/rules/

# Detailed analysis with recommendations
/rules-eval --detailed
```

## Evaluation Workflow

1. Scan `.claude/rules/` for all `.md` files (including subdirectories)
2. Validate YAML frontmatter syntax and fields
3. Analyze glob patterns for correctness and specificity
4. Assess content quality (actionable, concise, non-conflicting)
5. Check organization (naming, structure, symlinks)
6. Measure token efficiency and redundancy

## Scoring

| Category | Points | Focus |
|----------|--------|-------|
| Frontmatter Validity | 25 | YAML syntax, required fields, correct field names |
| Glob Pattern Quality | 20 | Syntax, specificity, quoting |
| Content Quality | 25 | Actionable, concise, non-conflicting |
| Organization | 15 | Naming, structure, symlink usage |
| Token Efficiency | 15 | Rule size, redundancy detection |

| Score | Level |
|-------|-------|
| 91-100 | Excellent - Production-ready |
| 76-90 | Good - Minor improvements possible |
| 51-75 | Basic - Needs optimization |
| 26-50 | Below Standards - Significant issues |
| 0-25 | Critical - Invalid or broken rules |

## Resources

### Skill-Specific Modules
- **Frontmatter Validation**: See `modules/frontmatter-validation.md`
- **Glob Pattern Analysis**: See `modules/glob-pattern-analysis.md`
- **Content Quality Metrics**: See `modules/content-quality-metrics.md`
- **Organization Patterns**: See `modules/organization-patterns.md`

### Tools
- **Rules Validator**: `scripts/rules_validator.py`

### Related Skills
- `abstract:skills-eval` - Skill evaluation framework
- `abstract:hooks-eval` - Hook evaluation framework
