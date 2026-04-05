---
name: evaluation-framework
description: |
  Patterns for building evaluation and scoring systems, quality gates, rubrics, and decision frameworks. Use for any scored assessment
version: 1.8.1
triggers:
  - evaluation
  - scoring
  - decision-making
  - metrics
  - quality
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Core Pattern](#core-pattern)
- [1. Define Criteria](#1-define-criteria)
- [2. Score Each Criterion](#2-score-each-criterion)
- [3. Calculate Weighted Total](#3-calculate-weighted-total)
- [4. Apply Decision Thresholds](#4-apply-decision-thresholds)
- [Quick Start](#quick-start)
- [Define Your Evaluation](#define-your-evaluation)
- [Example: Code Review Evaluation](#example:-code-review-evaluation)
- [Evaluation Workflow](#evaluation-workflow)
- [Common Use Cases](#common-use-cases)
- [Integration Pattern](#integration-pattern)
- [Detailed Resources](#detailed-resources)
- [Exit Criteria](#exit-criteria)


# Evaluation Framework

## Overview

A generic framework for weighted scoring and threshold-based decision making. Provides reusable patterns for evaluating any artifact against configurable criteria with consistent scoring methodology.

This framework abstracts the common pattern of: define criteria → assign weights → score against criteria → apply thresholds → make decisions.

## When To Use

- Implementing quality gates or evaluation rubrics
- Building scoring systems for artifacts, proposals, or submissions
- Need consistent evaluation methodology across different domains
- Want threshold-based automated decision making
- Creating assessment tools with weighted criteria

## When NOT To Use

- Simple pass/fail without scoring needs

## Core Pattern

### 1. Define Criteria

```yaml
criteria:
  - name: criterion_name
    weight: 0.30          # 30% of total score
    description: What this measures
    scoring_guide:
      90-100: Exceptional
      70-89: Strong
      50-69: Acceptable
      30-49: Weak
      0-29: Poor
```
**Verification:** Run the command with `--help` flag to verify availability.

### 2. Score Each Criterion

```python
scores = {
    "criterion_1": 85,  # Out of 100
    "criterion_2": 92,
    "criterion_3": 78,
}
```
**Verification:** Run the command with `--help` flag to verify availability.

### 3. Calculate Weighted Total

```python
total = sum(score * weights[criterion] for criterion, score in scores.items())
# Example: (85 × 0.30) + (92 × 0.40) + (78 × 0.30) = 85.5
```
**Verification:** Run the command with `--help` flag to verify availability.

### 4. Apply Decision Thresholds

```yaml
thresholds:
  80-100: Accept with priority
  60-79: Accept with conditions
  40-59: Review required
  20-39: Reject with feedback
  0-19: Reject
```
**Verification:** Run the command with `--help` flag to verify availability.

## Quick Start

### Define Your Evaluation

1. **Identify criteria**: What aspects matter for your domain?
2. **Assign weights**: Which criteria are most important? (sum to 1.0)
3. **Create scoring guides**: What does each score range mean?
4. **Set thresholds**: What total scores trigger which decisions?

### Example: Code Review Evaluation

```yaml
criteria:
  correctness: {weight: 0.40, description: Does code work as intended?}
  maintainability: {weight: 0.25, description: Is it readable?}
  performance: {weight: 0.20, description: Meets performance needs?}
  testing: {weight: 0.15, description: Tests detailed?}

thresholds:
  85-100: Approve immediately
  70-84: Approve with minor feedback
  50-69: Request changes
  0-49: Reject, major issues
```
**Verification:** Run `pytest -v` to verify tests pass.

### Evaluation Workflow

```text
**Verification:** Run the command with `--help` flag to verify availability.
1. Review artifact against each criterion
2. Assign 0-100 score for each criterion
3. Calculate: total = Σ(score × weight)
4. Compare total to thresholds
5. Take action based on threshold range
```
**Verification:** Run the command with `--help` flag to verify availability.

## Common Use Cases

**Quality Gates**: Code review, PR approval, release readiness
**Content Evaluation**: Document quality, knowledge intake, skill assessment
**Resource Allocation**: Backlog prioritization, investment decisions, triage

## Integration Pattern

```yaml
# In your skill's frontmatter
dependencies: [leyline:evaluation-framework]
```
**Verification:** Run the command with `--help` flag to verify availability.

Then customize the framework for your domain:
- Define domain-specific criteria
- Set appropriate weights for your context
- Establish meaningful thresholds
- Document what each score range means

## Detailed Resources

- **Scoring Patterns**: See `modules/scoring-patterns.md` for detailed methodology
- **Decision Thresholds**: See `modules/decision-thresholds.md` for threshold design

## Exit Criteria

- [ ] Criteria defined with clear descriptions
- [ ] Weights assigned and sum to 1.0
- [ ] Scoring guides documented for each criterion
- [ ] Thresholds mapped to specific actions
- [ ] Evaluation process documented and reproducible
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
