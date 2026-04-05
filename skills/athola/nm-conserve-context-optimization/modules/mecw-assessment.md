---
name: mecw-assessment
description: |
  Context usage analysis, risk identification, and optimization
  recommendations for MECW compliance.
category: conservation
---

# MECW Assessment Module

## Overview

This module provides tools and patterns for assessing context usage, identifying risks, and generating optimization recommendations.

## Context Analysis

### Usage Breakdown

```python
def analyze_context_usage(conversation):
    """
    Break down context usage by component.
    """
    return {
        'system_prompt': count_tokens(conversation.system),
        'user_messages': sum(count_tokens(m) for m in conversation.user_msgs),
        'assistant_responses': sum(count_tokens(m) for m in conversation.assistant_msgs),
        'tool_calls': sum(count_tokens(t) for t in conversation.tool_calls),
        'tool_results': sum(count_tokens(r) for r in conversation.tool_results),
    }
```

### Identifying Heavy Consumers

Common context-heavy patterns:
1. **Large file reads**: Reading entire files vs. targeted sections
2. **Verbose tool output**: Full command output vs. summaries
3. **Accumulated history**: Long conversation without compression
4. **Redundant includes**: Same information loaded multiple times

## Risk Identification

### Risk Levels

| Risk Level | Indicators | Action Required |
|------------|------------|-----------------|
| Low | < 30% usage, stable growth | Continue monitoring |
| Medium | 30-45% usage, moderate growth | Plan optimization |
| High | 45-55% usage, rapid growth | Implement optimization |
| Critical | > 55% usage | Immediate intervention |

### Risk Detection

```python
def identify_context_risks(usage_analysis):
    """
    Identify specific risks in current context usage.
    """
    risks = []

    if usage_analysis['tool_results'] > usage_analysis['user_messages'] * 2:
        risks.append({
            'type': 'tool_output_heavy',
            'severity': 'medium',
            'recommendation': 'Summarize tool outputs before storing'
        })

    if usage_analysis['assistant_responses'] > 0.4 * sum(usage_analysis.values()):
        risks.append({
            'type': 'verbose_responses',
            'severity': 'low',
            'recommendation': 'Consider more concise response patterns'
        })

    return risks
```

## Optimization Recommendations

### Content Strategies

1. **Chunking**: Process large files in segments
2. **Filtering**: Extract only relevant sections
3. **Summarization**: Compress completed work
4. **Deduplication**: Remove redundant information

### Implementation Patterns

```python
class OptimizationRecommender:
    def __init__(self, current_usage, target_usage=0.4):
        self.current = current_usage
        self.target = target_usage

    def get_recommendations(self):
        reduction_needed = self.current - self.target

        if reduction_needed <= 0:
            return []

        recommendations = []

        # Priority 1: Tool output compression
        if self._has_heavy_tool_output():
            recommendations.append({
                'action': 'compress_tool_output',
                'priority': 1,
                'estimated_savings': 0.15
            })

        # Priority 2: History summarization
        if self._has_long_history():
            recommendations.append({
                'action': 'summarize_history',
                'priority': 2,
                'estimated_savings': 0.20
            })

        # Priority 3: Subagent delegation
        if self._can_delegate():
            recommendations.append({
                'action': 'delegate_to_subagent',
                'priority': 3,
                'estimated_savings': 0.30
            })

        return recommendations
```

## Compliance Checking

### MECW Compliance Report

```python
def generate_compliance_report(session):
    """
    Generate detailed MECW compliance report.
    """
    usage = analyze_context_usage(session)
    total = sum(usage.values())
    percentage = (total / session.max_context) * 100

    return {
        'compliant': percentage < 50,
        'usage_percentage': percentage,
        'breakdown': usage,
        'risks': identify_context_risks(usage),
        'recommendations': get_recommendations(percentage),
        'trend': calculate_growth_trend(session.history)
    }
```

## Growth Management

### Trend Analysis

- **Stable**: < 5% growth per exchange
- **Growing**: 5-15% growth per exchange
- **Accelerating**: > 15% growth per exchange

### Preemptive Actions

1. **At 30%**: Enable monitoring mode
2. **At 40%**: Start planning optimization
3. **At 45%**: Begin active compression
4. **At 50%**: Trigger emergency protocols

## Integration

- **Principles**: Applies rules from `mecw-principles` module
- **Coordination**: Triggers `subagent-coordination` when needed
- **Conservation**: Works with `token-conservation` for budget management
