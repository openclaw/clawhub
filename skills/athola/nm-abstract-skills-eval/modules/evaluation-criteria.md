# Skill Evaluation Criteria

Detailed scoring rubric and quality gates for skill evaluation.

## Mathematical Foundation

This evaluation framework follows Multi-Criteria Decision Analysis (MCDA) best practices:

- **Normalization**: Vector normalization for scale invariance ([full methodology](multi-metric-evaluation-methodology.md))
- **Weighting**: AHP-derived weights with expert validation
- **Aggregation**: Weighted sum with Pareto analysis for trade-offs
- **Validation**: Sensitivity analysis on all weights

**Documentation**: See [Multi-Metric Evaluation Methodology](multi-metric-evaluation-methodology.md) for complete mathematical foundation.

## Scoring System (100 points total)

### Structure Compliance (20 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| YAML frontmatter | 5 | Complete, valid metadata within limits |
| Progressive disclosure | 5 | SKILL.md <500 lines, links to modules |
| Section organization | 5 | Logical flow, clear hierarchy |
| File naming | 3 | Gerund form, descriptive names |
| Reference depth | 2 | One-level deep references only |

**Frontmatter Validation:**

```yaml
name:
  max_length: 64
  pattern: "^[a-z0-9-]+$"
  forbidden: ["XML tags", "reserved words"]

description:
  max_length: 1024
  forbidden: ["XML tags"]
  required: ["WHAT it does", "WHEN to use it"]
```

**Official Frontmatter Fields** (per Claude Code docs):

| Field | Type | Validation |
|-------|------|------------|
| `name` | string | Required, kebab-case, max 64 chars |
| `description` | string | Recommended, front-load use case |
| `disable-model-invocation` | boolean | `true` or `false` |
| `user-invocable` | boolean | `true` or `false` |
| `allowed-tools` | string | Comma-separated tool names |
| `model` | string | Valid model name |
| `effort` | string | `low`, `medium`, `high`, `max` |
| `context` | string | Only `fork` supported |
| `agent` | string | Subagent type (with `context: fork`) |
| `argument-hint` | string | Shown in autocomplete |
| `paths` | string/array | Glob patterns for activation |
| `shell` | string | `bash` or `powershell` |
| `hooks` | object | Hooks scoped to skill lifecycle |

Extension fields (`version`, `category`, `tags`, etc.)
are permitted but not validated.

### Content Quality (25 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| Quick Start concreteness | 8 | Actual commands, not abstract descriptions |
| Clarity and completeness | 6 | Clear explanations, no ambiguity |
| Practical examples | 6 | Input/output pairs, real patterns |
| Voice consistency | 5 | Third person, no "your"/"you" language |

**Cargo Cult Anti-Pattern Detection:**

Skills must avoid cargo cult patterns - rituals that "look right" but lack verification:

- ❌ **Abstract Quick Start**: "Configure pytest" vs ✅ "Run `pytest --cov=src` to generate coverage"
- ❌ **Testing Theater**: Tests that always pass (`assert True`) vs ✅ Behavior-driven tests that fail when mutated
- ❌ **Implementation Testing**: Testing HOW not WHAT vs ✅ Testing behavior via Given-When-Then scenarios
- ❌ **Missing Verification**: Code examples without validation steps vs ✅ "Run `pytest -v` to confirm"
- ❌ **Documentation Exception**: "It's just markdown" vs ✅ All files have testable structure

**Quick Start Requirements:**

- ✅ **Good**: "Run `pytest --cov=src` to generate coverage reports"
- ❌ **Bad**: "Configure pytest and implement tests"

**Voice Consistency Checklist:**

- [ ] No "your needs" → use "project requirements"
- [ ] No "you should" → use imperative "Run X to Y"
- [ ] No "you can" → use "Available options include"
- [ ] Third person throughout ("the skill", "users", "developers")

### Token Efficiency (20 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| Content density | 5 | Concise, no unnecessary explanation |
| Progressive loading | 5 | Essential content first |
| Navigation aids | 6 | TOCs in modules >100 lines |
| Context optimization | 4 | Efficient context usage |

**Navigation Requirements (Critical):**

```yaml
navigation_rules:
  - condition: "module_length > 100 lines"
    requirement: "Table of Contents after frontmatter"
    penalty: "-2 points"
    rationale: "Agentic search requires TOC for efficient grep-based navigation"

  - condition: "module_length > 200 lines"
    requirement: "Section anchors and backlinks"
    penalty: "-3 points"
```

**Table of Contents Format:**

```markdown
## Table of Contents

- [Section Name](#section-name)
- [Another Section](#another-section)
```

### Activation Reliability (20 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| Description triggers | 7 | 5+ specific trigger phrases |
| Context indicators | 5 | Clear usage scenarios |
| Trigger clarity | 5 | Differentiates from alternatives |
| Discovery patterns | 3 | Easy to find and categorize |

**Trigger Phrase Requirements:**

- Minimum 5 specific phrases in description
- Include domain-specific terminology
- Cover common task descriptions
- Examples: "pytest fixtures", "unittest replacement", "test coverage"

**Example Good Description:**

```yaml
description: |
  Pytest testing framework with async support and fixtures.

  Triggers: pytest, async testing, unittest replacement, test fixtures,
  test coverage, mocking, pytest fixtures, parametrized tests

  Use when: writing tests with pytest, migrating from unittest, setting up
  test infrastructure, implementing async tests
```

### Tool Integration (10 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| Script quality | 4 | Solves errors explicitly |
| Verification steps | 3 | Post-example validation |
| Configuration clarity | 2 | No magic numbers |
| Execute vs read | 1 | Clear usage intent |

**Verification Requirements:**

After each code example, include validation steps:

```markdown
### Example: Async Test with Fixture

\`\`\`python
@pytest.mark.asyncio
async def test_async_operation():
    result = await async_operation()
    assert result.status == "success"
\`\`\`

**Verification:** Run `pytest -v tests/test_async.py::test_async_operation` to confirm the async test executes correctly.
```

### Documentation Completeness (5 points)

| Aspect | Max Points | Requirements |
|--------|------------|--------------|
| Troubleshooting | 2 | Common issues documented |
| Reference materials | 2 | Complete API references |
| Time-sensitivity | 1 | No date-dependent instructions |

## Quality Levels

| Score | Level | Description |
|-------|-------|-------------|
| 91-100 | Excellent (A) | Production-ready, reference implementation |
| 76-90 | Good (B) | Strong with minor improvements needed |
| 51-75 | Fair (C) | Functional but needs significant work |
| 26-50 | Poor (D) | Major issues need addressing |
| 0-25 | Critical (F) | Fundamental problems |

## Quality Gates

Default thresholds for CI/CD integration:

```yaml
quality_gates:
  structure_score: ">= 80"
  content_score: ">= 85"
  token_efficiency: ">= 75"
  activation_score: ">= 80"
  tool_integration: ">= 70"
  overall_score: ">= 75"
  max_critical_issues: 0
  max_high_issues: 3
```

### Sensitivity Analysis Requirements

Before finalizing quality gates, run sensitivity analysis:

```yaml
sensitivity_analysis:
  variation: 0.20  # ±20% weight variation

  requirements:
    stable_rankings: true  # Rankings shouldn't change
    critical_weights_identified: true  # Document sensitive weights

  critical_threshold: 0.8  # Spearman correlation < 0.8 = sensitive
```

See [Sensitivity Analysis](multi-metric-evaluation-methodology.md#sensitivity-analysis) for implementation details.

### Gate Behaviors

| Gate | Failure Action |
|------|----------------|
| `structure_score` | Block deployment, fix frontmatter |
| `content_score` | Warn, suggest improvements |
| `token_efficiency` | Warn, recommend modularization |
| `activation_score` | Block until triggers improved |
| `max_critical_issues` | Immediate block |

## Issue Classification

### Critical Issues (Immediate Action Required)

- Missing YAML frontmatter
- Invalid frontmatter schema
- No trigger phrases in description
- Security vulnerabilities
- Broken functionality
- References to deleted `skills/shared/modules/` files (broken links)

### High Issues (Address Before Next Release)

- Missing TOC in modules >100 lines (-2 points)
- Abstract Quick Start without commands (-2 points)
- Second-person voice slips ("your"/"you") (-1 point)
- Missing verification steps after examples (-1 point)
- Fewer than 5 trigger phrases (-1 point)
- SKILL.md exceeds 500 lines
- Modules in deprecated `skills/shared/` directory (-2 points, relocate to skill-specific `modules/`)

### Medium Issues (Address Soon)

- Suboptimal content density
- Weak context indicators
- Limited trigger phrases
- Missing troubleshooting section

### Low Issues (Nice to Fix)

- Minor formatting inconsistencies
- Additional example enhancements
- Documentation polish
- Performance optimizations

## Evaluation Report Format

### Summary Format

```
=== Skills Evaluation Report ===
Plugin: {name} (v{version})
Scope: {scope}
Total skills: {count}

=== Scores ===
Structure:      {score}/100 ({level})
Content:        {score}/100 ({level})
Token Efficiency: {score}/100 ({level})
Activation:     {score}/100 ({level})
Tool Integration: {score}/100 ({level})
Documentation:  {score}/100 ({level})
────────────────────────────────
Overall:        {score}/100 ({level})

=== Issues ===
Critical: {count}
High: {count}
Medium: {count}
Low: {count}
```

### Detailed Format

Includes per-skill breakdown:

```
=== Skill: {skill_name} ===
Path: {skill_path}
Lines: {line_count} (SKILL.md: {skill_lines})

Structure Issues:
  [HIGH] Module async-testing.md (192 lines) missing TOC (-2 points)
  [MEDIUM] SKILL.md exceeds 500 lines (-1 point)

Content Issues:
  [HIGH] Quick Start too abstract: "Configure pytest" (-2 points)
  [HIGH] Second-person voice: "your needs" at line 74 (-1 point)
  [HIGH] Missing verification after async test example (-1 point)

Activation Issues:
  [HIGH] Only 2 trigger phrases in description (-1 point)

Recommendations:
  1. Add TOC to async-testing.md after frontmatter
  2. Update Quick Start with actual pytest commands
  3. Replace "your needs" with "project requirements"
  4. Add "Run pytest -v tests/test_async.py" after async example
  5. Expand description with: "unittest replacement", "test coverage"

Impact: +7 points → 96/100 (A grade)
```

## Customization

### Per-Skill Configuration

Create `.skills-eval.yaml` in plugin root:

```yaml
skills_eval:
  # Override thresholds
  thresholds:
    skill_max_lines: 500
    module_max_lines: 100
    min_trigger_phrases: 5
    min_description_length: 50

  # Content requirements
  content_requirements:
    require_quick_start: true
    require_verification_steps: true
    require_troubleshooting: true

  # Voice and style
  style_requirements:
    forbid_second_person: true
    require_third_person: true
    forbidden_phrases:
      - "your needs"
      - "you should"
      - "you can"

  # Navigation requirements
  navigation_requirements:
    toc_threshold_lines: 100
    toc_section_anchors: true
    toc_backlinks: true

  # Custom rules
  custom_rules:
    - name: "require-examples"
      applies_to: ["implementation-skills"]
      check: "count_code_examples >= 3"
      severity: "medium"

    - name: "require-tools"
      applies_to: ["automation-skills"]
      check: "tools.length > 0"
      severity: "high"

  # Excluded paths
  exclude_paths:
    - "skills/experimental/*"
    - "skills/deprecated/*"
```

## Quick Reference Checklist

Use this checklist when reviewing skills:

### Structure (20 points)
- [ ] Valid YAML frontmatter with all required fields
- [ ] SKILL.md under 500 lines
- [ ] Clear section organization
- [ ] One-level deep references only
- [ ] Descriptive file names (gerund form)

### Content (25 points)
- [ ] Quick Start has actual commands
- [ ] Clear, complete explanations
- [ ] Practical input/output examples
- [ ] Third-person voice throughout
- [ ] No "your"/"you" language

### Token Efficiency (20 points)
- [ ] Concise, dense content
- [ ] Progressive disclosure structure
- [ ] **TOCs in all modules >100 lines**
- [ ] Efficient context usage

### Activation (20 points)
- [ ] **5+ trigger phrases in description**
- [ ] Clear context indicators
- [ ] Differentiates from alternatives
- [ ] Easy to discover

### Tools (10 points)
- [ ] Scripts solve errors explicitly
- [ ] **Verification steps after examples**
- [ ] No magic numbers
- [ ] Clear execute vs read intent

### Documentation (5 points)
- [ ] Troubleshooting section exists
- [ ] Complete reference materials
- [ ] No time-sensitive language
