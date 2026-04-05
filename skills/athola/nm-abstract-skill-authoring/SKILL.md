---
name: skill-authoring
description: |
  Guide to creating Claude Code skills using TDD methodology and persuasion principles. Use for new skill development
version: 1.8.1
triggers:
  - authoring
  - tdd
  - skills
  - writing
  - best-practices
  - validation
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83d\udee0\ufe0f", "requires": {"config": ["night-market.modular-skills"]}}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Skill Authoring Guide

## Overview

Writing effective Claude Code skills requires Test-Driven Development (TDD) and persuasion principles from compliance research. We treat skill writing as process documentation that needs empirical validation rather than just theoretical instruction. Skills are behavioral interventions designed to change model behavior in measurable ways.

By using TDD, we ensure skills address actual failure modes identified through testing. Optimized descriptions improve discovery, while a modular structure supports progressive disclosure to manage token usage. This framework also includes anti-rationalization patterns to prevent the assistant from bypassing requirements.

### The Iron Law

**NO SKILL WITHOUT A FAILING TEST FIRST**

Every skill must begin with documented evidence of Claude failing without it. This validates that you are solving a real problem. No implementation should proceed without a failing test, and no completion claim should be accepted without evidence. Detailed enforcement patterns for adversarial verification and coverage gates are available in `imbue:proof-of-work`.

## Skill Types

We categorize skills into three types: **Technique** skills for specific methods, **Pattern** skills for recurring solutions, and **Reference** skills for quick lookups and checklists. This helps organize interventions into the most effective format for the task.

## Quick Start

### Skill Analysis
\`\`\`bash
# Analyze skill complexity
python scripts/analyze.py

# Estimate tokens
python scripts/tokens.py
\`\`\`

### Validation
\`\`\`bash
# Validate skill structure
python scripts/abstract_validator.py --check
\`\`\`

**Verification**: Run analysis and review token estimates before proceeding.
## Description Optimization

Skill descriptions must be optimized for semantic search and explicit triggering. Follow the formula `[What it does] + [When to use it] + [Key triggers]`. Use a third-person voice (e.g., "Guides...", "Provides...") and include specific, concrete use cases. Avoid marketing language or vague phrases like "helps with coding."

### Skill Character Budget (Claude Code 2.1.32+)

Skill description character budgets now **scale with context window** at 2% of available context. This means:

| Context Window | Description Budget |
|---------------|-------------------|
| 200K (Sonnet/Haiku) | ~4,000 characters |
| 1M (Opus 4.6 GA) | ~20,000 characters |

Previously constrained skills can use more descriptive text on larger windows. However, keep descriptions concise regardless — longer is not better. The scaling primarily prevents truncation for skills with legitimately complex trigger conditions, not as an invitation to add verbose content.

### Plugin Name Auto-Display (Claude Code 2.1.33+)

Plugin names are now automatically shown alongside skill descriptions in the `/skills` menu. Do not repeat the plugin name in skill descriptions — it is redundant and wastes character budget. Focus descriptions on what the skill does and when to use it.

## The TDD Cycle for Skills

### RED Phase: Document Baseline Failures
Establish empirical evidence that an intervention is needed. Create at least three pressure scenarios that combine time pressure and ambiguity. Run these in a fresh instance without the skill active and document the exact failures, such as skipped error handling or missing validation.

### GREEN Phase: Minimal Skill Implementation
Create the smallest intervention that addresses the documented failures. Write the `SKILL.md` with required frontmatter and content that directly counters the baseline failures. Include one example of correct behavior and verify that the same pressure scenarios now show measurable improvement.

### REFACTOR Phase: Anti-Rationalization
Eliminate the ability for Claude to explain away requirements. Run pressure scenarios with the skill active to identify common rationalizations, such as claiming a task is "too simple" for the full process. Add explicit counters, such as exception tables and red flag lists, until rationalizations stop.

## Anti-Rationalization

Skills must explicitly counter patterns where Claude attempts to bypass requirements. Common excuses include claiming a task is "too simple" or that a "spirit vs letter of the law" approach is sufficient. Skills should include red flag lists for self-checking, such as "Stop if you think: this is too simple for the full process." When exceptions are necessary, document them explicitly to prevent unauthorized shortcuts.

## Module References

For detailed implementation guidance:
- **TDD Methodology**: See `modules/tdd-methodology.md` for RED-GREEN-REFACTOR cycle details
- **Persuasion Principles**: See `modules/persuasion-principles.md` for compliance research and techniques
- **Description Writing**: See `modules/description-writing.md` for discovery optimization
- **Progressive Disclosure**: See `modules/progressive-disclosure.md` for file structure patterns
- **Anti-Rationalization**: See `modules/anti-rationalization.md` for bulletproofing techniques
- **Graphviz Conventions**: See `modules/graphviz-conventions.md` for process diagram standards
- **Testing with Subagents**: See `abstract:subagent-testing` skill for pressure testing methodology
- **Deployment Checklist**: See `modules/deployment-checklist.md` for final validation

## Deployment and Quality Gates

Before deploying, verify that the RED, GREEN, and REFACTOR phases are complete and documented. Frontmatter must be valid, descriptions optimized, and line counts kept under 500 lines. Ensure all module references are valid and at least one concrete example is included.

### Scribe Validation
All markdown files must pass scribe validation. This includes a slop scan to ensure a score under 2.5 and doc verification to confirm all file paths and command examples work. Bullet-to-prose ratios must remain under 60% to maintain readability. Use `Skill(scribe:slop-detector)` and `Agent(scribe:doc-verifier)` for these checks.

## Integration and Best Practices

Individual skills are created using `skill-authoring`, while `modular-skills` handles the architecture of larger structures. `skills-eval` provides ongoing quality assessment. Avoid the common pitfall of writing skills based on theoretical behavior; always use documented failures to guide development. Use progressive disclosure to prevent monolithic files and ensure that each intervention remains focused and token-efficient.
## Skill Directory Variable (2.1.69+)

Skills can reference their own directory using
`${CLAUDE_SKILL_DIR}` in SKILL.md content. This
variable resolves to the absolute path of the
directory containing the SKILL.md file. Use it for
referencing sibling files, data assets, or module
paths without hardcoding absolute paths:

```markdown
See `${CLAUDE_SKILL_DIR}/modules/advanced.md`
for detailed patterns.

Run: `python3 ${CLAUDE_SKILL_DIR}/scripts/check.py`
```

This is especially useful for skills that ship
alongside scripts or data files and need portable
path references that work regardless of where the
plugin is installed.

### Description Colon Fix (2.1.69+)

Skill descriptions containing colons (e.g.,
`description: "Triggers include: X, Y, Z"`) previously
failed to load from SKILL.md frontmatter. This is
fixed in 2.1.69. Skills without a `description:` field
also now appear in the available skills list (previously
they were silently excluded).

## Troubleshooting

### Common Issues

**Skill not loading**
Check YAML frontmatter syntax and required fields.
As of 2.1.69, skills without a `description:` field
still appear in the skills list, but descriptions
with colons must be quoted in YAML frontmatter.

**Token limits exceeded**
Use progressive disclosure - move details to modules

**Modules not found**
Verify module paths in SKILL.md are correct
