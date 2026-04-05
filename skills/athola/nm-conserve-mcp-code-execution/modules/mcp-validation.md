---
name: mcp-validation
description: Monitor MECW compliance and hallucination prevention
  with validation checks.
location: plugin
token_budget: 150  # Streamlined validation focus
progressive_loading: true
dependencies:
  hub: [mcp-code-execution]
  modules: []
---

# MCP Validation Module

## Quick Start
Monitor MECW compliance and hallucination prevention for MCP workflows
with real-time risk assessment.

## When to Use
- **Automatic**: Keywords: `validate`, `check`, `monitor`, `compliance`, `MECW`
- **Pre-Execution**: Before running MCP workflows
- **Post-Execution**: After completing transformations
- **Continuous Monitoring**: During long-running workflows

## Required TodoWrite Items
1. `mcp-validation:assess-mecw-risk`
2. `mcp-validation:monitor-compliance`
3. `mcp-validation:validate-hallucination-prevention`
4. `mcp-validation:generate-alerts`

## MECW Risk Assessment

### Context Risk Analysis
- **Critical Risk**: Context usage >50% (very high hallucination risk)
- **High Risk**: Current usage >MECW threshold (70-90% risk)
- **Low Risk**: Context under threshold (<20% risk)

### Task-Specific MECW Thresholds
- Simple data processing: 250 tokens
- Tool chain conversion: 375 tokens
- Complex analysis: 125 tokens
- Report generation: 150 tokens

## Step 1 – Assess MECW Risk (`mcp-validation:assess-mecw-risk`)

### Risk Indicators
Monitor context pressure, MECW violations, response consistency,
fact coherence, and hallucination patterns.

### Early Warning System
- **Warning**: Context pressure >40% (60-80% hallucination probability)
- **Critical**: MECW violations detected (90% to 100% probability)
- **Safe**: All indicators normal (<20% probability)

## Step 2 – Monitor Compliance (`mcp-validation:monitor-compliance`)

### Compliance Validation
- **Context Usage**: Must stay under 50% of total window
- **Hallucination Rate**: Must stay under 20%
- **Token Efficiency**: Must maintain >50% savings
- **MECW Adherence**: Follow task-specific thresholds

### Continuous Tracking
Track compliance history, violation counts, and trend analysis
to identify patterns and prevent future issues.

## Step 3 – Validate Hallucination Prevention
(`mcp-validation:validate-hallucination-prevention`)

### Hallucination Detection
Check for factual inconsistency, logical contradictions,
confidence mismatch, and context drift.

### Prevention Measurement
- **Target**: >80% reduction in hallucination rates
- **MECW Impact**: Context reduction to under 50%
- **Accuracy Preservation**: Maintain or improve baseline accuracy

## Step 4 – Generate Alerts (`mcp-validation:generate-alerts`)

### Alert Levels
- **Critical**: Immediate action required, execution stop
- **Warning**: Review recommended, monitoring increased
- **Info**: Normal operation, continue monitoring

### Emergency Response
For critical violations: stop execution, compact context, migrate state,
decompose into subagents.

## Success Metrics

### Validation Criteria
- **MECW Compliance Rate**: >95% of executions under 50% context
- **Hallucination Prevention**: >80% reduction in rates
- **Early Warning Accuracy**: >90% of risks correctly predicted
- **Response Time**: <5% overhead from validation

## Integration Points

### With MCP Code Execution Hub
- Receives workflow data for validation
- Returns compliance assessments and recommendations
- Coordinates emergency response procedures

### With Context Optimization
- Shares MECW risk assessments
- Coordinates validation strategies
- Provides compliance metrics for optimization
