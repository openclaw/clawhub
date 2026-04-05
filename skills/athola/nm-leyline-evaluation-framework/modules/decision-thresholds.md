---
name: decision-thresholds
description: Patterns for designing threshold-based decision frameworks with clear actions
category: evaluation
tags: [thresholds, decisions, automation, gates]
estimated_tokens: 700
---

# Decision Thresholds

Patterns and best practices for designing effective threshold-based decision frameworks.

## Core Concepts

### What Are Thresholds?

Thresholds are score ranges that map to specific decisions or actions. They transform continuous scores into discrete decision points.

```
Score Range → Decision → Action
80-100      → Accept   → Deploy immediately
60-79       → Review   → Manual approval needed
0-59        → Reject   → Send back for revision
```

### Why Use Thresholds?

- **Consistency**: Same score always gets same decision
- **Automation**: Enable automated decision-making
- **Clarity**: Clear criteria for each outcome
- **Accountability**: Documented decision logic

## Threshold Design Patterns

### Binary Thresholds

Simplest pattern - pass or fail:

```yaml
thresholds:
  70-100: Pass
  0-69:   Fail
```

Use when:
- Decision is truly binary (deploy/don't deploy)
- No middle ground exists
- Automation is critical

### Multi-Tier Thresholds

Multiple decision levels with different actions:

```yaml
thresholds:
  90-100: Excellent - Fast track
  75-89:  Good - Standard process
  60-74:  Fair - Additional review
  40-59:  Poor - Major revisions needed
  0-39:   Fail - Reject
```

Use when:
- Different quality levels warrant different treatments
- Resources should be allocated differently
- Multiple stakeholders with different concerns

### Conditional Thresholds

Thresholds that depend on context:

```yaml
thresholds:
  production_deployment:
    90-100: Auto-deploy
    80-89:  Deploy with manual verification
    0-79:   Block deployment

  development_deployment:
    60-100: Auto-deploy
    0-59:   Block deployment
```

Use when:
- Risk tolerance varies by context
- Different environments have different requirements
- Stakeholder needs differ

### Compound Thresholds

Multiple criteria must meet thresholds:

```yaml
decision_rules:
  approve_if:
    - overall_score >= 80
    - all_critical_criteria >= 70
    - no_blocking_issues

  reject_if:
    - overall_score < 60
    - OR any_critical_criterion < 50
    - OR has_security_vulnerability
```

Use when:
- Single criteria can veto a decision
- Minimum bars exist across dimensions
- Safety-critical decisions

## Setting Threshold Levels

### Data-Driven Approach

Use historical data to inform thresholds:

```python
# Analyze past evaluations
historical_scores = [...]
percentiles = {
    "p90": 87,  # 90th percentile
    "p75": 78,  # 75th percentile
    "p50": 65,  # median
    "p25": 52,  # 25th percentile
}

# Set thresholds based on desired selectivity
thresholds = {
    "excellent": percentiles["p90"],  # Top 10%
    "good": percentiles["p75"],       # Top 25%
    "acceptable": percentiles["p50"],  # Top 50%
}
```

### Risk-Based Approach

Set thresholds based on acceptable risk levels:

```yaml
# High-risk decision (production deployment)
thresholds:
  90-100: Proceed - minimal risk
  80-89:  Caution - some risk, monitor closely
  0-79:   Block - unacceptable risk

# Low-risk decision (internal tool)
thresholds:
  70-100: Proceed - acceptable risk
  50-69:  Proceed with warning
  0-49:   Review - may still proceed
```

### Stakeholder-Driven Approach

Align thresholds with stakeholder expectations:

```yaml
# Engineering standards
technical_thresholds:
  maintain: 85
  acceptable: 70

# Business requirements
business_thresholds:
  launch_ready: 75
  beta_ready: 60
```

## Action Mapping

### Explicit Actions

Map each threshold range to specific, actionable steps:

```yaml
80-100:
  decision: Approve
  actions:
    - Auto-merge PR
    - Deploy to production
    - Notify stakeholders
    - Update metrics

60-79:
  decision: Conditional Approve
  actions:
    - Request senior review
    - Deploy to staging
    - Schedule follow-up
    - Document concerns

40-59:
  decision: Request Changes
  actions:
    - Block merge
    - Create detailed feedback
    - Assign back to author
    - Set expected timeline

0-39:
  decision: Reject
  actions:
    - Close PR
    - Document reasons
    - Suggest alternatives
    - Offer guidance
```

### Graduated Responses

Scale response intensity with score:

```yaml
critical_issues_by_threshold:
  0-39:   Block completely
  40-59:  Block with waiver option
  60-74:  Warning, proceed if acknowledged
  75-89:  Info only, no action required
  90-100: No issues detected
```

### Escalation Paths

Define who decides at each threshold:

```yaml
approval_authority:
  90-100: Automated approval
  80-89:  Team lead approval
  70-79:  Manager approval
  60-69:  Director approval required
  0-59:   Automatic rejection
```

## Threshold Validation

### Testing Threshold Effectiveness

```python
# Evaluate threshold performance
def validate_thresholds(historical_data, thresholds):
    metrics = {
        "false_positives": 0,  # Approved but failed
        "false_negatives": 0,  # Rejected but would succeed
        "true_positives": 0,   # Approved and succeeded
        "true_negatives": 0,   # Rejected correctly
    }

    for case in historical_data:
        decision = apply_threshold(case.score, thresholds)
        actual = case.actual_outcome

        if decision == "approve" and actual == "success":
            metrics["true_positives"] += 1
        elif decision == "approve" and actual == "failure":
            metrics["false_positives"] += 1
        # ... etc

    return metrics
```

### Calibration Over Time

Thresholds should evolve:

```yaml
threshold_evolution:
  initial: 70    # Start conservative
  after_3_months: 75   # Tighten as quality improves
  after_6_months: 80   # Continue raising bar
  target: 85     # Long-term goal
```

## Special Cases

### Veto Criteria

Some criteria can override total score:

```python
def apply_decision(scores, weights):
    total = calculate_weighted_score(scores, weights)

    # Veto conditions
    if scores["security"] < 60:
        return "REJECT - Security threshold not met"

    if scores["legal_compliance"] < 80:
        return "REJECT - Compliance requirement not met"

    # Standard threshold logic
    if total >= 80:
        return "APPROVE"
    elif total >= 60:
        return "REVIEW"
    else:
        return "REJECT"
```

### Confidence Intervals

Account for scoring uncertainty:

```yaml
score_with_confidence:
  point_estimate: 75
  confidence_interval: [70, 80]
  confidence_level: 0.95

threshold_application:
  pessimistic: use_lower_bound(70)  # Conservative
  expected: use_point_estimate(75)   # Balanced
  optimistic: use_upper_bound(80)    # Aggressive
```

### Grace Periods

Allow time for improvement:

```yaml
initial_evaluation:
  score: 65
  threshold: 70
  decision: Provisional acceptance with 30-day improvement plan

follow_up_evaluation:
  score: 72
  decision: Full acceptance
```

## Common Patterns

### Quality Gates

```yaml
gate_sequence:
  gate_1_unit_tests:
    threshold: 80
    blocker: true

  gate_2_integration_tests:
    threshold: 75
    blocker: true

  gate_3_performance:
    threshold: 70
    blocker: false  # Warning only
```

### Progressive Disclosure

```yaml
# Initial quick check
rapid_assessment:
  threshold: 50
  action: If pass, proceed to detailed evaluation

# Detailed evaluation
full_assessment:
  threshold: 75
  action: If pass, approve
```

### Hysteresis

Different thresholds for entering vs. exiting a state:

```yaml
status_transitions:
  promote_to_production:
    threshold: 85

  remain_in_production:
    threshold: 70  # Lower bar to stay than to enter

  demote_from_production:
    threshold: 69
```

## Best Practices

### Clear Boundaries

Avoid overlapping ranges:
- Good: `80-100`, `60-79`, `0-59`
- Bad: `80-100`, `60-80`, `0-60`

### Document Rationale

```yaml
threshold: 75
rationale: |
  Historical data shows 75+ correlates with 95% success rate
  in production. This balances velocity with quality.
  Reviewed quarterly based on actual outcomes.
```

### Make Thresholds Visible

```python
# Include in reports
evaluation_result = {
    "score": 78,
    "threshold_range": "60-79",
    "decision": "Conditional Approve",
    "distance_to_next_tier": 2,  # Points to reach 80
    "improvements_needed": [
        "Increase test coverage by 5%",
        "Resolve 2 remaining linting issues"
    ]
}
```

### Plan for Edge Cases

```yaml
edge_case_handling:
  score_exactly_on_boundary:
    score: 80
    rule: "Round up - belongs to higher tier"

  missing_criterion_data:
    rule: "Use conservative estimate or require completion"

  partial_evaluations:
    rule: "Scale thresholds proportionally to evaluated criteria"
```

## Validation Checklist

Before deploying threshold-based decisions:

- [ ] Thresholds cover full 0-100 range
- [ ] No gaps or overlaps between ranges
- [ ] Each range maps to specific action
- [ ] Actions are documented and achievable
- [ ] Veto criteria clearly defined
- [ ] Edge cases handled explicitly
- [ ] Rationale documented for each threshold
- [ ] Review process established
- [ ] Metrics tracked for validation
- [ ] Escalation paths defined
