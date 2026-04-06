---
name: scoring-patterns
description: Detailed methodology for scoring artifacts against evaluation criteria with MCDA best practices
category: evaluation
tags: [scoring, methodology, consistency, calibration, normalization, weighting]
estimated_tokens: 900
---

# Scoring Patterns

Detailed patterns and best practices for consistent, calibrated scoring across evaluations using Multi-Criteria Decision Analysis (MCDA) principles.

## Mathematical Foundation

This scoring methodology follows research-validated MCDA practices:

- **Normalization**: Vector normalization (scale-invariant)
- **Weighting**: Validated through AHP or expert elicitation
- **Sensitivity**: All weights tested for robustness
- **Reproducibility**: Same inputs → same outputs

**Related**: [Multi-Metric Evaluation Methodology](https://claude-night-market/plugins/abstract/skills/skills-eval/modules/multi-metric-evaluation-methodology.md)

## Scoring Methodology

### The 0-100 Scale

Use a consistent 0-100 scale for all criteria scoring:

```
90-100: Exceptional - Exceeds all expectations
70-89:  Strong - Meets expectations with notable strengths
50-69:  Acceptable - Meets minimum requirements
30-49:  Weak - Below standards, needs improvement
0-29:   Poor - Does not meet basic requirements
```

### Calibration Guidelines

**Avoid score inflation**: Not everything can be 90+. Reserve high scores for truly exceptional work.

**Use the full range**: Don't cluster scores in 70-85 range. Differentiate clearly.

**Anchor to examples**: Document reference examples at each score level for consistency.

**Inter-rater reliability**: Multiple evaluators should score similarly when using the same rubric.

**Validate normalization**: Use scale-invariant normalization (vector normalization) to ensure rankings don't change with unit conversions.

**Test sensitivity**: Verify rankings are stable to reasonable weight variations (±20%).

## Criterion Design Patterns

### Quantitative Criteria

For measurable attributes, use objective thresholds:

```yaml
performance:
  90-100: Response time < 100ms
  70-89:  Response time 100-200ms
  50-69:  Response time 200-500ms
  30-49:  Response time 500-1000ms
  0-29:   Response time > 1000ms
```

### Qualitative Criteria

For subjective attributes, provide clear descriptors:

```yaml
clarity:
  90-100: Crystal clear, zero ambiguity, exemplary explanations
  70-89:  Clear with minor gaps, mostly well-explained
  50-69:  Generally understandable, some confusion possible
  30-49:  Confusing in places, requires clarification
  0-29:   Unclear or incomprehensible
```

### Composite Criteria

Break complex criteria into sub-components:

```yaml
code_quality:
  components:
    - readability (40%)
    - efficiency (30%)
    - error_handling (30%)

  calculate: weighted_avg(sub_scores)
```

## Weight Assignment Patterns

### Critical: Validate Your Weights

Don't use arbitrary weights. Derive them systematically:

**Option 1: Analytic Hierarchy Process (AHP)**
- Pairwise comparison of criteria
- Calculates weights with consistency checks
- Requires consistency ratio < 0.1

**Option 2: Expert Judgment Elicitation**
- Structured process with 5-15 experts
- Calibration questions to assess accuracy
- Performance-based weighting of contributions

**Option 3: Empirical Validation**
- Test weights against historical outcomes
- Adjust based on predictive validity
- Document validation results

### Priority-Based Weighting

Assign weights based on importance to outcome:

```python
# Critical success factors get highest weight
critical_criteria = 0.50-0.70  # Must-have qualities
important_criteria = 0.20-0.30  # Nice-to-have qualities
supplemental_criteria = 0.05-0.15  # Additional considerations

# Requirement: Document how weights were derived
weights_derivation:
  method: "AHP"  # or "expert_judgment" or "empirical"
  experts: 5
  consistency_ratio: 0.04
  date: "2025-01-07"
```

### Equal Weighting

When criteria are equally important:

```python
num_criteria = 5
weight_per_criterion = 1.0 / num_criteria  # 0.20 each
```

### Stakeholder-Driven Weighting

Different stakeholders may weight criteria differently:

```yaml
engineering_perspective:
  technical_quality: 0.50
  maintainability: 0.30
  performance: 0.20

business_perspective:
  time_to_market: 0.40
  feature_completeness: 0.35
  technical_quality: 0.25
```

## Scoring Consistency Patterns

### Reference Anchors

Document specific examples at key score levels:

```yaml
criterion: documentation_quality

anchors:
  95: "See: project-alpha/docs - detailed, clear, examples"
  80: "See: project-beta/docs - good coverage, minor gaps"
  65: "See: project-gamma/docs - basic, functional"
  40: "See: project-delta/docs - incomplete, unclear"
```

### Comparative Scoring

Score relative to known benchmarks:

```
Score = (artifact_performance / benchmark_performance) × 100

Example:
  Test coverage: 85%
  Benchmark: 90%
  Score: (85/90) × 100 = 94.4
```

### Rubric Matrices

Use decision matrices for complex evaluations:

```
Dimension 1: Completeness (columns)
Dimension 2: Quality (rows)

           Partial  Complete  detailed
Excellent    70       85         95
Good         55       70         85
Fair         40       55         70
Poor         25       40         55
```

## Advanced Patterns

### Penalty Systems

Apply deductions for specific issues:

```python
base_score = 85
penalties = {
    "security_vulnerability": -20,
    "breaking_change": -15,
    "missing_tests": -10,
    "documentation_gap": -5
}

final_score = max(0, base_score - sum(applicable_penalties))
```

### Bonus Systems

Award extra points for exceptional qualities:

```python
base_score = 75
bonuses = {
    "innovation": +10,
    "exceptional_performance": +10,
    "comprehensive_testing": +5
}

final_score = min(100, base_score + sum(applicable_bonuses))
```

### Non-Linear Scoring

Some criteria may warrant non-linear scales:

```python
# Exponential for critical metrics
security_score = 100 * (1 - e^(-vulnerabilities))

# Logarithmic for diminishing returns
feature_score = 100 * log(features_implemented + 1) / log(total_features + 1)
```

### Conditional Scoring

Some criteria only apply in certain contexts:

```yaml
scoring_rules:
  - if: artifact_type == "public_api"
    then: apply_criteria(backward_compatibility, weight=0.30)

  - if: artifact_type == "internal_tool"
    then: skip_criteria(backward_compatibility)
```

## Scoring Workflow

### 1. Pre-Evaluation Preparation

```
- Review scoring rubric
- Understand each criterion
- Check reference anchors
- Calibrate expectations
```

### 2. Initial Assessment

```
- Quick pass through all criteria
- Note obvious strengths/weaknesses
- Identify areas needing deeper analysis
```

### 3. Detailed Scoring

```
- Score each criterion independently
- Document reasoning for each score
- Note specific evidence supporting score
- Flag edge cases or uncertainties
```

### 4. Review and Calibration

```
- Check scores against anchors
- Verify consistency across criteria
- Adjust outliers if needed
- Document final rationale
```

### 5. Calculate and Decide

```
- Apply weights to compute total
- Compare to decision thresholds
- Document recommended action
- Provide specific feedback
```

## Common Pitfalls

### Halo Effect
Don't let overall impression influence individual criterion scores. Score each independently.

### Central Tendency Bias
Don't cluster all scores around 50-70. Use the full range when appropriate.

### Recency Bias
Don't overweight recent observations. Consider the full artifact.

### Confirmation Bias
Don't score to match a predetermined conclusion. Let the rubric guide you.

### Inconsistent Rigor
Apply the same level of scrutiny to all artifacts, regardless of source or context.

## Validation Checks

Before finalizing scores:

- [ ] All criteria scored on 0-100 scale
- [ ] Scores match rubric descriptions
- [ ] Evidence documented for each score
- [ ] Weights sum to 1.0
- [ ] **Weights validated through AHP or expert elicitation**
- [ ] **Normalization method documented (vector/minmax/log)**
- [ ] **Scale invariance tested** (unit changes don't affect rankings)
- [ ] **Sensitivity analysis completed** (±20% weight variation)
- [ ] Calculations verified
- [ ] Threshold determination clear
- [ ] Feedback actionable and specific

## Required Documentation

Every evaluation must document:

```yaml
evaluation_metadata:
  normalization:
    method: "vector"  # or "minmax" or "log"
    scale_invariant: true
    rationale: "Vector normalization preserves rankings under unit changes"

  weighting:
    method: "AHP"  # or "expert_judgment" or "empirical"
    derivation_date: "2025-01-07"
    experts: 5
    consistency_ratio: 0.04  # < 0.1 required

  sensitivity:
    variation_tested: 0.20  # ±20%
    critical_weights: ["content_quality"]  # Rankings sensitive to these
    stable_weights: ["documentation"]  # Rankings robust
    spearman_correlation: 0.92  # Overall stability

  aggregation:
    method: "weighted_sum"  # or "TOPSIS" or "Pareto"
    independence_assumption: "Preferential independence assumed"
    trade_offs: "Documented in multi-dimensional report"
```
