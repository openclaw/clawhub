---
name: methodology-curator
description: Surface expert frameworks and methodologies
version: 1.8.1
triggers:
  - methodology
  - frameworks
  - expertise
  - curation
  - design
  - evaluation
  - creating or evaluating skills
  - hooks
  - or agents
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\udde0"}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Workflow Integration](#workflow-integration)
- [Domain Modules](#domain-modules)
- [When to Skip](#when-to-skip)
- [Masters Overview](#masters-overview)
- [Selection Matrix](#selection-matrix)

# Methodology Curator

## Overview

Identifying the best way to approach a domain is often more difficult than the technical scaffolding itself. This skill surfaces frameworks from domain masters to prevent reinventing established processes and identify methodology gaps in existing work. It should be used as a brief initial check before brainstorming or evaluation begins.

## Workflow Integration

When starting new work, identify the domain (e.g., Instruction Design, Code Review, or Knowledge Management) and consult the corresponding module in `modules/` to discover experts and their frameworks. Select principles that fit your context and document them in a methodology brief before proceeding to creation.

For existing work, determine what the skill or hook is trying to teach and compare it against established frameworks. This gap analysis identifies opportunities to add missing principles or align terminology with recognized standards. Surgically add methodology rather than rewriting from scratch to maintain authority and effectiveness.

## Domain Modules

Each module in the `modules/` directory provides a curated list of masters, key works, and actionable frameworks. These resources include selection guides and anti-patterns to avoid for each domain.

- **Instruction Design**: `modules/instruction-design.md` - Teaching techniques and behavioral objectives.
- **Code Review**: `modules/code-review.md` - Review methodologies and feedback patterns.
- **Debugging**: `modules/debugging.md` - Systematic troubleshooting frameworks.
- **Testing**: `modules/testing.md` - TDD masters and test design patterns.
- **Knowledge Management**: `modules/knowledge-management.md` - Note-taking and knowledge systems.
- **Decision Making**: `modules/decision-making.md` - Mental models and decision frameworks.

## When to Skip

### Skip for Creation when:
- You're implementing a well-defined spec
- The domain is highly specific to your codebase
- You've already researched methodologies externally
- Creating a simple utility with no pedagogical component

### Skip for Evaluation when:
- Fixing syntax/structural issues (use `/validate-plugin` instead)
- The work is purely mechanical (no methodology to ground)
- Already performed a recent methodology audit
- Quick bug fixes that don't change the approach

## Domain Modules

Each module contains:
- **Masters**: Recognized experts in the domain
- **Key Works**: Essential books/papers/talks
- **Frameworks**: Actionable methodologies
- **Selection Guide**: When to use each approach
- **Anti-patterns**: What to avoid

### Adding New Domains

To expand the masters database, create a new module following this template:

```markdown
# [Domain Name] Masters

## Masters Overview
| Expert | Key Contribution | Best For |
|--------|-----------------|----------|
| Name   | Framework/Book  | Context  |

## Detailed Frameworks

### [Framework 1]
**Source**: [Expert] - [Work]
**Core Idea**: [One sentence]
**Key Principles**:
- Principle 1
- Principle 2
**Use When**: [Context]
**Avoid When**: [Anti-context]

## Selection Matrix
[Decision guide for choosing between frameworks]
```

## Integration with Skill Authoring

After curating methodologies, the skill authoring workflow benefits from:

1. **Grounded TDD scenarios**: Test against the methodology's expected behaviors
2. **Principled anti-rationalization**: Counter excuses using the methodology's logic
3. **Authoritative references**: Cite masters in skill documentation
4. **Consistent terminology**: Use the methodology's vocabulary

## Related

### For Creation
- `/create-skill` - Skill creation workflow (use after this)
- `/create-hook` - Hook creation workflow
- `superpowers:brainstorming` - Refine approach after methodology selection
- `skill-authoring` - Detailed skill writing guidance

### For Evaluation
- `/skills-eval` - Evaluate skill quality (complements methodology audit)
- `/analyze-skill` - Analyze skill complexity
- `/bulletproof-skill` - Harden against rationalization
- `pensive:code-reviewer` - Code review (uses code-review domain)
