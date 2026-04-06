# Progressive Disclosure for Token Efficiency

## Overview

Progressive disclosure structures skills so Claude loads only what's needed when it's needed. This keeps context windows efficient while maintaining detailed functionality.

## Core Principle

**SKILL.md is the table of contents, not the encyclopedia.**

- Main file provides overview and entry points
- Detailed content lives in separate files
- Claude loads details only when needed
- Keeps initial context small and focused

## File Structure Pattern

### Hub-and-Spoke Model

```
skill-name/
├── SKILL.md              # Hub: 300-500 lines
├── modules/              # Spokes: detailed content
│   ├── concept-1.md
│   ├── concept-2.md
│   └── advanced-patterns.md
└── scripts/              # Tools: executable utilities
    └── validator.py
```

**SKILL.md** contains:
- Frontmatter (YAML)
- Overview (what/why)
- Quick start (minimal example)
- When to use (activation conditions)
- Common tasks (high-level)
- Module references (links to details)

**Modules** contain:
- Deep dives on specific topics
- Advanced techniques
- Edge cases and troubleshooting
- Detailed examples

**Scripts** contain:
- Executable validation
- Analysis tools
- Automation utilities

## Line Count Guidelines

### SKILL.md Target: Under 500 Lines

**Rationale:**
- Entire skill loads in ~600 tokens
- Quick to scan and understand
- Minimal initial context consumption
- Forces focus on essential information

**What to Keep:**
- Required frontmatter
- Core concepts overview
- Single minimal example
- High-level workflow
- Module references

**What to Move:**
- Detailed explanations → modules
- Additional examples → modules
- Edge cases → modules
- Troubleshooting → modules
- Tool documentation → scripts/README.md

### Module Target: 200-400 Lines Each

**Rationale:**
- Focused on single topic
- Loaded only when needed
- Still readable in one sitting
- Easy to maintain and update

**Structure:**
- Clear topic focus
- Progressive complexity
- Examples throughout
- Cross-references minimal

## Reference Depth: One Level Only

### The Rule

SKILL.md can reference modules.
Modules should NOT reference other modules extensively.

### Why

**Problem with deep references:**
```
SKILL.md → module-a.md → module-b.md → module-c.md
```
Claude must load entire chain to understand context.
Defeats progressive disclosure purpose.

**Better approach:**
```
SKILL.md → module-a.md
SKILL.md → module-b.md
SKILL.md → module-c.md
```
Each module stands alone.
Load only what's needed for current task.

### Exception: Shared Resources

Acceptable to reference shared utilities:

```
modules/
├── core-concepts.md      # Referenced by SKILL.md
├── advanced-patterns.md  # References core-concepts for foundation
└── troubleshooting.md    # References both above for context
```

**Guideline**: If a module needs >2 other modules to make sense, restructure it.

## Content Distribution Strategy

### What Goes in SKILL.md

#### 1. The 80/20 Content

Cover 80% of use cases with 20% of content:

```markdown
## Quick Start

Most common workflow:
1. Run baseline tests
2. Write minimal skill
3. Validate improvements

For advanced scenarios, see modules:
- Complex workflows: `modules/advanced-patterns.md`
- Troubleshooting: `modules/troubleshooting.md`
```

#### 2. High-Level Overview

Conceptual understanding without implementation details:

```markdown
## Core Concept

Skills use TDD methodology:
- RED: Document failures
- GREEN: Minimal fix
- REFACTOR: Bulletproof

For detailed RED phase process, see `modules/tdd-methodology.md`
```

#### 3. One Complete Example

Single end-to-end example showing typical usage:

```markdown
## Example: Secure API Skill

1. Document baseline (3 scenarios)
2. Write skill addressing failures
3. Add anti-rationalization

For additional examples, see `modules/examples.md`
```

#### 4. Common Tasks Overview

High-level task list with module pointers:

```markdown
## Common Tasks

- **Creating new skill**: See "Quick Start" above
- **Optimizing descriptions**: See `modules/description-writing.md`
- **Bulletproofing**: See `modules/anti-rationalization.md`
```

### What Goes in Modules

#### 1. Deep Dives

detailed coverage of specific topics:

```markdown
# TDD Methodology for Skills

## RED Phase: Complete Guide

### Designing Pressure Scenarios

Create scenarios combining:
1. Time pressure ("quickly")
2. Ambiguity ("standard approach")
3. Multiple requirements
4. Edge cases

[... detailed examples and analysis ...]
```

#### 2. Advanced Techniques

Beyond basic usage:

```markdown
# Advanced Patterns

## Multi-Skill Composition

When skills need to work together:
[... detailed composition strategies ...]

## Conditional Loading

Load modules based on context:
[... conditional logic examples ...]
```

#### 3. Edge Cases and Troubleshooting

Specific problems and solutions:

```markdown
# Troubleshooting

## Skill Not Activating

Symptoms:
- Claude doesn't load skill for relevant tasks
- Activation is inconsistent

Causes:
1. Description too generic
2. Missing discovery terms
3. Competing skills

Solutions:
[... detailed debugging steps ...]
```

#### 4. Extended Examples

Additional real-world scenarios:

```markdown
# Example Gallery

## Example 1: Security Skill

Complete TDD cycle for API security:
[... full detailed example ...]

## Example 2: Testing Skill

[... another complete example ...]
```

## Progressive Complexity Pattern

Structure content from simple to complex:

### SKILL.md: Entry Level

```markdown
## Quick Start

1. Document failures
2. Write skill
3. Test improvements

See modules for details.
```

### Module: Intermediate

```markdown
# TDD Methodology

## Basic Approach

1. Create 3 pressure scenarios
2. Run without skill
3. Document failures verbatim

## Scenario Design

Combine these factors:
- Time pressure
- Ambiguity
- Multiple requirements

[... examples and guidance ...]
```

### Module Section: Advanced

```markdown
## Advanced Scenario Design

### Multi-Factor Pressure

Combine 4+ challenge factors:
[... sophisticated examples ...]

### Adversarial Testing

Design scenarios to trigger specific rationalizations:
[... advanced techniques ...]
```

## Loading Patterns

### Explicit References

Make module references clear and actionable:

**Good:**
```markdown
For detailed description optimization techniques,
see `modules/description-writing.md`
```

**Vague:**
```markdown
More information is available in the modules directory.
```

### Just-In-Time Loading

Structure so Claude loads modules when needed:

```markdown
## Common Tasks

### Task 1: Create New Skill
[Brief inline guidance]

### Task 2: Optimize Discovery
This requires understanding description patterns.
See `modules/description-writing.md` for:
- Discovery term selection
- "Use when" clause structure
- A/B testing methodology
```

### Lazy Evaluation

Don't force module loading upfront:

**Eager Loading (avoid):**
```markdown
Before using this skill, read all modules:
- modules/tdd-methodology.md
- modules/persuasion-principles.md
- modules/anti-rationalization.md
```

**Lazy Loading (preferred):**
```markdown
Start with Quick Start below.
Reference modules as needed for specific tasks.
```

## Token Budgeting

### Estimation Formula

```
Total tokens = SKILL.md + (loaded modules) + (context overhead)
```

**Target budgets:**
- SKILL.md: ~600 tokens (500 lines)
- Module: ~300-500 tokens each (200-400 lines)
- Context overhead: ~200 tokens
- **Initial load**: ~800 tokens
- **With 1 module**: ~1,300 tokens
- **With 3 modules**: ~2,300 tokens

### Optimization Strategies

#### 1. Defer Examples

One example in SKILL.md, more in modules:

```yaml
estimated_tokens: 800  # SKILL.md only
```

```markdown
# In modules/examples.md
estimated_tokens: 1200  # All examples
```

#### 2. Split Large Topics

Instead of one 800-line module:

```
modules/
├── core-concepts.md      # 300 lines
├── advanced-patterns.md  # 300 lines
└── troubleshooting.md    # 200 lines
```

#### 3. Compression Techniques

Use tables instead of prose:

 **Verbose (20 lines):**
```markdown
The first principle is Authority. This means using
directive language. For example, instead of saying
"consider adding validation," say "must add validation."
This is because...
```

 **Compressed (5 lines):**
```markdown
| Principle | Weak | Strong |
|-----------|------|--------|
| Authority | "Consider validation" | "Must validate" |
```

## File Organization Examples

### Example 1: TDD Skill

```
tdd-workflow/
├── SKILL.md (450 lines)
│   ├── Overview
│   ├── Quick Start
│   ├── Common Tasks
│   └── Module References
└── modules/
    ├── red-phase.md (350 lines)
    ├── green-phase.md (300 lines)
    ├── refactor-phase.md (300 lines)
    └── examples.md (400 lines)
```

**Total**: 1,800 lines
**Initial load**: 450 lines
**Typical usage**: 450 + 350 = 800 lines
**Full exploration**: All 1,800 lines

### Example 2: Security Skill

```
secure-api/
├── SKILL.md (400 lines)
│   ├── Core Requirements
│   ├── One Example
│   └── Module Links
└── modules/
    ├── authentication.md (300 lines)
    ├── validation.md (250 lines)
    ├── error-handling.md (200 lines)
    └── advanced-threats.md (350 lines)
```

**Total**: 1,500 lines
**Initial load**: 400 lines
**Task-specific**: 400 + 300 = 700 lines

### Example 3: Monolithic (Anti-Pattern)

 **Don't do this:**
```
skill-name/
└── SKILL.md (1,500 lines)
    ├── Everything in one file
    ├── All examples
    ├── All edge cases
    └── All troubleshooting
```

**Problem**: Always loads 1,500 lines even for simple tasks

## Refactoring Monolithic Skills

### Process

1. **Identify Sections** in current SKILL.md
2. **Categorize**:
   - Essential (keep in SKILL.md)
   - Detailed (move to modules)
   - Reference (move to modules)
3. **Extract Modules** with focused topics
4. **Update References** in SKILL.md
5. **Test** to validate coherence

### Example Refactoring

**Before (1,000 lines):**
```markdown
# API Security

## Overview
[100 lines]

## Authentication Deep Dive
[300 lines]

## Validation Techniques
[250 lines]

## Error Handling
[200 lines]

## Examples
[150 lines]
```

**After (400 + modules):**
```markdown
# API Security (SKILL.md - 400 lines)

## Overview
[100 lines]

## Core Requirements
[150 lines]

## Quick Example
[50 lines]

## Detailed Topics
- Authentication: `modules/authentication.md`
- Validation: `modules/validation.md`
- Error Handling: `modules/error-handling.md`
- Examples: `modules/examples.md`
```

```markdown
# modules/authentication.md (300 lines)
[Detailed authentication content]

# modules/validation.md (250 lines)
[Detailed validation content]

# modules/error-handling.md (200 lines)
[Detailed error handling content]

# modules/examples.md (150 lines)
[All examples]
```

## Validation

### Checklist

- [ ] SKILL.md under 500 lines
- [ ] Each module 200-400 lines
- [ ] Module references one level deep
- [ ] Clear loading path (when to read modules)
- [ ] No circular references
- [ ] Examples progressively complex
- [ ] Quick start doesn't require modules
- [ ] Module topics focused and distinct
- [ ] estimated_tokens in frontmatter accurate

### Tool

```bash
# Check line counts
wc -l SKILL.md modules/*.md

# Validate structure
python scripts/skill_validator.py --check-structure
```

## Summary

Progressive disclosure principles:
1. **SKILL.md is the hub** (under 500 lines)
2. **Modules are spokes** (200-400 lines each)
3. **One level deep** (avoid deep reference chains)
4. **Load on demand** (don't force eager loading)
5. **Progressive complexity** (simple → advanced)
6. **Token budgeting** (~800 initial, ~1,500 with modules)

Goal: Claude loads minimum content needed for current task, with clear path to deeper details when required.
