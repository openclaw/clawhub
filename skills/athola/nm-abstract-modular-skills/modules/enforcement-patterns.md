# Enforcement Patterns for Skill Design

## Overview

This module provides patterns for designing skill frontmatter that validates reliable discovery and appropriate enforcement. These patterns complement the shared modules in `shared-modules/` with skill-specific guidance.

## The Frontmatter-Only Trigger Pattern

### Problem

Claude's skill selection uses the `description` field to decide which skill to read. If conditional logic lives in the skill body:

1. Claude must already be reading the skill to discover it applies (chicken-and-egg)
2. Skills get read unnecessarily, wasting tokens
3. Skill triggering becomes inconsistent

### Solution

Put ALL trigger logic in the description field:

```yaml
description: |
  [ACTION VERB + CAPABILITY]. [1-2 sentences max]

  Triggers: [comma-separated keywords for discovery]

  Use when: [specific scenarios, symptoms, or contexts]

  DO NOT use when: [explicit negative triggers] - use [ALTERNATIVE] instead.

  [ENFORCEMENT if applicable]
```

### Implementation Checklist

When creating a new skill:

- [ ] Write description with Triggers, Use when, DO NOT use when
- [ ] Do NOT add "When to Use" section in body
- [ ] Match enforcement language to skill category
- [ ] Name alternative skills explicitly in negative triggers
- [ ] Verify description is self-contained (readable alone)

## Skill Category Classification

Classify your skill to determine appropriate enforcement language:

| Category | Description | Examples |
|----------|-------------|----------|
| **Discipline-Enforcing** | Process must be followed exactly | TDD, security, compliance |
| **Workflow** | Structured approach to tasks | Brainstorming, debugging, review |
| **Technique** | Best practices, optional patterns | Caching, optimization |
| **Reference** | Information retrieval | API docs, examples |

## Enforcement Language by Category

### Discipline-Enforcing Skills (Maximum Intensity)

```yaml
description: |
  [Capability statement].

  Triggers: [keywords]

  Use when: [conditions]

  DO NOT use when: [exclusions] - use [alternative] instead.

  YOU MUST use this skill when [critical conditions]. This is NON-NEGOTIABLE.
  NEVER skip this skill when [requirements].
  No exceptions without explicit user permission.
```

**Key phrases**: "YOU MUST", "NON-NEGOTIABLE", "NEVER skip", "No exceptions"

### Workflow Skills (High Intensity)

```yaml
description: |
  [Capability statement].

  Triggers: [keywords]

  Use when: [conditions]

  DO NOT use when: [exclusions] - use [alternative] instead.

  Use this skill BEFORE starting [task type]. Check even if unsure.
  If you think this doesn't apply, reconsider - it probably does.
```

**Key phrases**: "BEFORE starting", "Check even if unsure", "reconsider"

### Technique Skills (Medium Intensity)

```yaml
description: |
  [Capability statement].

  Triggers: [keywords]

  Use when: [conditions]

  DO NOT use when: [exclusions] - use [alternative] instead.

  Consider this skill when [symptoms appear].
```

**Key phrases**: "Use when", "Consider when", "Recommended for"

### Reference Skills (Low Intensity)

```yaml
description: |
  [Capability statement].

  Triggers: [keywords]

  Use when: [conditions]

  DO NOT use when: [exclusions] - use [alternative] instead.

  Available for [use cases]. Consult when needed.
```

**Key phrases**: "Available for", "Consult when needed"

## Negative Trigger Design

### Why Negative Triggers Matter

Without explicit "DO NOT use when":
- Skills with overlapping domains trigger simultaneously
- Claude wastes context reading irrelevant skills
- Users get confused about which skill applies

### Pattern for Negative Triggers

Always:
1. Identify skills with overlapping domains
2. Name each explicitly in "DO NOT use when"
3. Provide clear handoff guidance

```yaml
DO NOT use when: evaluating existing skill quality - use skills-eval instead.
DO NOT use when: writing prose for humans - use writing-clearly-and-concisely.
DO NOT use when: debugging runtime errors - use systematic-debugging instead.
```

### Common Overlaps to Address

| Your Skill Domain | Common Overlaps | Resolution |
|------------------|-----------------|------------|
| Skill creation | Skill evaluation | modular-skills vs skills-eval |
| Debugging | Code review | systematic-debugging vs code-review |
| Planning | Brainstorming | writing-plans vs brainstorming |
| Testing | Security | TDD vs security-review |

## CSO (Claude Search Optimization)

### Effective Keywords

Use concrete, specific terms that match what users say:

**Good triggers:**
- "flaky tests", "race conditions", "memory leak"
- "TypeError", "undefined", "null reference"
- "refactoring skills", "breaking down monolith"
- "token optimization", "context efficiency"

**Avoid generic terms:**
- "help", "process", "manage"
- "improve", "fix", "update" (without specificity)
- "work with", "handle"

### Keyword Selection Process

1. List user phrases that should trigger this skill
2. Include error messages and symptoms
3. Add task-type keywords
4. Include technology-specific terms
5. Remove generic words that don't differentiate

## Integration with Modular Design

When designing modular skills:

1. **SKILL.md frontmatter**: All trigger logic here
2. **SKILL.md body**: Start immediately with workflow/overview
3. **modules/**: Progressive disclosure of details
4. **Shared modules**: Reference via relative paths

```
skills/<skill-name>/
├── SKILL.md           # Frontmatter has ALL triggers
│                      # Body has NO "When to Use" section
└── modules/
    └── *.md           # Deep-dive content, loaded on demand
```

## Validation

Before shipping a skill, verify with skills-eval:

```bash
# Check trigger isolation compliance
python scripts/compliance_checker.py --skill-path path/to/skill/SKILL.md
```

Expected output:
- No "Body contains 'When to Use'" warnings
- Trigger isolation score >= 7/10
- All negative triggers present

## Related Resources

- [Trigger Patterns](../../../shared-modules/trigger-patterns.md) - Description field templates
- [Enforcement Language](../../../shared-modules/enforcement-language.md) - Intensity calibration
- [Anti-Rationalization](../../../shared-modules/anti-rationalization.md) - Bypass prevention
- [Trigger Isolation Analysis](../../skills-eval/modules/trigger-isolation-analysis.md) - Evaluation criteria
