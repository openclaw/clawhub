# Trigger Isolation Analysis

## Overview

This module provides criteria and workflows for evaluating whether skills properly isolate all trigger logic in the YAML description field (frontmatter).

## Why Trigger Isolation Matters

Claude's skill selection uses the `description` field to decide which skill to read. If conditional logic lives in the skill body:

1. **Discovery fails**: Claude must already be reading the skill to discover it applies
2. **Token waste**: Skills get read unnecessarily when they don't apply
3. **Inconsistent behavior**: Sometimes skills trigger, sometimes they don't

## Evaluation Criteria

### Trigger Isolation Score (10 points)

| Score | Criteria |
|-------|----------|
| 10 | ALL conditional logic in description, no "When to Use" in body |
| 8 | Conditional logic in description, minor duplication in body |
| 5 | Split between description and body (partial isolation) |
| 2 | Most conditional logic in body, minimal description |
| 0 | No trigger information in description |

### What to Check

**In the description field:**
- [ ] `Triggers:` keyword with comma-separated discovery terms
- [ ] `Use when:` with specific scenarios
- [ ] `DO NOT use when:` with explicit alternatives
- [ ] Enforcement statement if discipline-enforcing skill

**In the skill body:**
- [ ] NO "When to Use" or "When to Use It" section
- [ ] NO "Perfect for" / "Don't use when" lists
- [ ] NO conditional logic that duplicates description

### Red Flags

These patterns indicate poor trigger isolation:

```markdown
# BAD: Trigger logic in body
## When to Use
Use this skill when you need to...

# BAD: Conditional in body that should be in description
This skill is perfect for:
- Scenario A
- Scenario B
```

### Good Patterns

```yaml
# GOOD: All logic in description
description: |
  [Capability].

  Triggers: keyword1, keyword2, symptom1

  Use when: scenario A, scenario B, condition C

  DO NOT use when: scenario X - use skill-Y instead.
---

# Body starts immediately with workflow
## Quick Start
```

## Enforcement Language Compliance (5 points)

| Score | Criteria |
|-------|----------|
| 5 | Language intensity matches skill category exactly |
| 3 | Mostly appropriate, minor calibration needed |
| 1 | Significant mismatch (e.g., reference skill with "MUST") |
| 0 | No enforcement language when required |

### Skill Categories and Required Intensity

| Category | Examples | Required Language |
|----------|----------|------------------|
| Discipline-Enforcing | TDD, security, compliance | Maximum: "YOU MUST", "NON-NEGOTIABLE" |
| Workflow | Brainstorming, debugging, review | High: "Use BEFORE", "Check even if unsure" |
| Technique | Patterns, optimization | Medium: "Use when", "Consider for" |
| Reference | API docs, examples | Low: "Available for", "Consult when" |

## Negative Trigger Coverage (5 points)

| Score | Criteria |
|-------|----------|
| 5 | All related skills explicitly named in "DO NOT use when" |
| 3 | Some alternatives named, some missing |
| 1 | Generic "don't use" without naming alternatives |
| 0 | No negative triggers |

### How to Identify Missing Negative Triggers

1. List all skills in the same plugin
2. Identify skills with overlapping domains
3. Verify each is mentioned in "DO NOT use when" with clear handoff

## Automated Checks

The `compliance_checker.py` script checks:

```python
# Trigger isolation checks
- description_has_triggers()    # "Triggers:" in description
- description_has_use_when()    # "Use when:" in description
- description_has_not_use()     # "DO NOT use when:" in description
- body_has_when_to_use()        # Should be False
- body_duplicates_triggers()    # Should be False
```

## Workflow

### Manual Skill Audit

1. **Read description field only**
   - Can you determine when to use this skill from description alone?
   - If no: trigger isolation is incomplete

2. **Scan body for conditional sections**
   - Search for "When to", "Perfect for", "Don't use"
   - Any matches indicate duplication

3. **Check enforcement language**
   - Identify skill category
   - Verify language intensity matches

4. **Verify negative triggers**
   - List related skills
   - Confirm all are mentioned in "DO NOT use when"

### Batch Audit (All Skills in Plugin)

```bash
# Run compliance check on all skills
python scripts/compliance_checker.py --plugin abstract --check trigger-isolation

# Generate report
python scripts/compliance_checker.py --plugin abstract --report markdown
```

## Integration with Other Modules

- **Evaluation Framework**: Trigger isolation is weighted at 10% of total score
- **Quality Metrics**: Affects Activation Reliability category
- **Pressure Testing**: Include trigger edge cases in adversarial tests

## Related Resources

- [Trigger Patterns](../../../shared-modules/trigger-patterns.md) - Description field templates
- [Enforcement Language](../../../shared-modules/enforcement-language.md) - Intensity calibration
- [Anti-Rationalization](../../../shared-modules/anti-rationalization.md) - Bypass prevention
