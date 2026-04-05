---
name: reversibility-assessment
description: Framework for evaluating decision reversibility and mapping to appropriate deliberation intensity
category: war-room-module
tags: [reversibility, type-1, type-2, decision-making, bezos-framework]
dependencies: []
estimated_tokens: 900
references:
  - https://fs.blog/reversible-irreversible-decisions/
  - https://tapandesai.com/one-way-two-way-doors-decision-making/
  - https://ashikuzzaman.com/2025/03/03/amazons-type-1-vs-type-2-decisions-a-framework-for-effective-decision-making/
---

# Reversibility Assessment Framework

Evaluate decision reversibility to calibrate deliberation intensity. Based on Amazon's Type 1/Type 2 framework with quantified scoring.

## Core Principle

> "Make reversible decisions as soon as possible and make irreversible decisions as late as possible."
> — Jeff Bezos

**The Problem**: Organizations tend to apply heavyweight Type 1 processes to all decisions, stifling speed and innovation. This framework ensures resources match stakes.

## Reversibility Score (RS)

### Five Dimensions

Score each dimension on a 1-5 scale:

| Dimension | 1 (Highly Reversible) | 3 (Moderate) | 5 (Irreversible) |
|-----------|----------------------|--------------|------------------|
| **Reversal Cost** | Trivial (<1 day effort) | Significant (1-2 weeks) | Prohibitive (months+, major rework) |
| **Time Lock-In** | Can reverse anytime | Window narrows over weeks | Decision crystallizes immediately |
| **Blast Radius** | Single component/person | Team/subsystem affected | Organization/customer-wide |
| **Information Loss** | All options preserved | Some paths closed | Critical options eliminated |
| **Reputation Impact** | Internal only | Limited external visibility | Public commitment, trust at stake |

### Calculation

```
Reversibility Score (RS) = Sum of Dimensions / 25

RS Range: 0.04 (most reversible) to 1.0 (least reversible)
```

### Decision Type Classification

**Default Thresholds** (can be overridden at session start):

| RS Range | Type | Door Metaphor | Deliberation Mode |
|----------|------|---------------|-------------------|
| 0.04 - 0.40 | **Type 2** | Two-way door | Express (single expert) |
| 0.41 - 0.60 | **Type 1B** | Heavy door | Standard (lightweight panel) |
| 0.61 - 0.80 | **Type 1A** | One-way door | Full Council |
| 0.81 - 1.00 | **Type 1A+** | Locked vault | Full Council + Delphi |

> **Note**: These thresholds are defaults calibrated for general use. Teams with different risk tolerances can adjust at session initialization.

## Scoring Guide

### Reversal Cost

| Score | Description | Examples |
|-------|-------------|----------|
| 1 | Trivial - flip a switch | Feature flag, config change, UI tweak |
| 2 | Minor - hours of work | Revert a PR, rollback deployment |
| 3 | Moderate - days of work | Refactor a module, change API internally |
| 4 | Significant - weeks | Database migration rollback, contract renegotiation |
| 5 | Prohibitive - months+ | Rewrite architecture, undo public API, M&A |

### Time Lock-In

| Score | Description | Examples |
|-------|-------------|----------|
| 1 | No deadline pressure | Internal tool improvement |
| 2 | Soft deadline, flexible | Quarterly planning decision |
| 3 | Decision hardens over weeks | Hiring, vendor selection |
| 4 | Short window before lock | Product launch timing |
| 5 | Immediate crystallization | Crisis response, public announcement |

### Blast Radius

| Score | Description | Examples |
|-------|-------------|----------|
| 1 | Single file/component | Utility function implementation |
| 2 | Single module/service | Internal service refactor |
| 3 | Multiple modules/team | API contract change |
| 4 | Cross-team/system | Platform architecture |
| 5 | Organization/customers | Pricing model, security policy |

### Information Loss

| Score | Description | Examples |
|-------|-------------|----------|
| 1 | All options preserved | A/B test, experiment |
| 2 | Minor path closure | Choosing one of many equivalent libs |
| 3 | Some alternatives eliminated | Tech stack component selection |
| 4 | Significant option reduction | Monorepo vs polyrepo |
| 5 | Critical paths closed forever | Open source vs proprietary, cloud provider |

### Reputation Impact

| Score | Description | Examples |
|-------|-------------|----------|
| 1 | Internal, easily corrected | Internal process change |
| 2 | Internal, visible to leadership | Team restructuring |
| 3 | Limited external visibility | Beta feature to select customers |
| 4 | Moderate external impact | Public roadmap commitment |
| 5 | High visibility, trust at stake | Security incident response, pricing change |

## Example Assessments

### Example 1: Add retry logic to API client

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Reversal Cost | 1 | Can revert PR |
| Time Lock-In | 1 | No deadline |
| Blast Radius | 2 | Single service |
| Information Loss | 1 | All options preserved |
| Reputation Impact | 1 | Internal only |

**RS = 6/25 = 0.24 → Type 2 (Express)**

*Recommendation*: Chief Strategist can decide alone. Execute quickly.

---

### Example 2: Migrate from PostgreSQL to MongoDB

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Reversal Cost | 5 | Months of rework |
| Time Lock-In | 4 | Migration path hardens quickly |
| Blast Radius | 5 | All services affected |
| Information Loss | 4 | Query patterns, ACID guarantees |
| Reputation Impact | 2 | Internal (unless downtime) |

**RS = 20/25 = 0.80 → Type 1A (Full Council)**

*Recommendation*: Convene full council. Extensive Red Team review required.

---

### Example 3: Change public API pricing model

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Reversal Cost | 4 | Contract/billing rework |
| Time Lock-In | 5 | Announcement locks commitment |
| Blast Radius | 5 | All customers affected |
| Information Loss | 4 | Pricing flexibility reduced |
| Reputation Impact | 5 | Public trust at stake |

**RS = 23/25 = 0.92 → Type 1A+ (Full Council + Delphi)**

*Recommendation*: Maximum deliberation. Delphi convergence required. Consider external advisors.

## Integration with War Room

### Threshold Configuration

At session initialization, the War Room prompts for threshold customization:

```
War Room Session Initialization
═══════════════════════════════
Problem: [User's decision statement]

Reversibility Thresholds (press Enter for defaults):
  Express ceiling    [0.40]: _
  Lightweight ceiling [0.60]: _
  Full Council ceiling [0.80]: _

Using: express ≤0.40 | lightweight ≤0.60 | full_council ≤0.80 | delphi >0.80
```

**Common Adjustments:**

| Team Profile | Express | Lightweight | Full Council | Rationale |
|--------------|---------|-------------|--------------|-----------|
| **Default** | 0.40 | 0.60 | 0.80 | Balanced |
| **Move Fast** | 0.50 | 0.70 | 0.90 | Higher risk tolerance, faster decisions |
| **Risk Averse** | 0.30 | 0.50 | 0.70 | Lower thresholds, more deliberation |
| **Startup** | 0.55 | 0.75 | 0.90 | Speed over process |
| **Regulated** | 0.25 | 0.45 | 0.65 | Compliance-heavy, thorough review |

### Automatic Mode Selection

```python
def select_deliberation_mode(
    reversibility_score: float,
    thresholds: dict | None = None
) -> str:
    """Map RS to war room mode with configurable thresholds."""
    # Defaults (can be overridden at session start)
    t = thresholds or {
        "express": 0.40,
        "lightweight": 0.60,
        "full_council": 0.80,
    }

    if reversibility_score <= t["express"]:
        return "express"  # Single expert, immediate
    elif reversibility_score <= t["lightweight"]:
        return "lightweight"  # Default panel
    elif reversibility_score <= t["full_council"]:
        return "full_council"  # All experts
    else:
        return "full_council_delphi"  # Iterative convergence
```

### Escalation Override

Supreme Commander may override automatic classification when:
1. Novel domain with uncertain reversibility
2. Precedent-setting decision (future decisions will follow)
3. Compound decisions (multiple sub-decisions with varying RS)
4. Political/organizational sensitivity beyond technical scope

### Resource Allocation by Type

| Type | Experts | Rounds | Target Duration | Token Budget |
|------|---------|--------|-----------------|--------------|
| Express | 1 | 1 | < 2 min | 500 |
| Lightweight | 3 | 2 | 5-10 min | 2,500 |
| Full Council | 7 | 2 | 15-30 min | 8,000 |
| Full Council + Delphi | 7 | 3-5 | 30-60 min | 15,000 |

## Quick Assessment Heuristics

For rapid classification without full scoring:

### Likely Type 2 (Two-Way Door)
- Can be A/B tested
- Affects only internal systems
- Has natural rollback mechanism
- No public announcement required
- Team-level decision authority

### Likely Type 1 (One-Way Door)
- Requires data migration
- Changes external contracts/APIs
- Involves personnel decisions (hiring/firing)
- Requires public commitment
- Affects security/compliance posture
- Closes off future architectural options

## Anti-Patterns

### Over-Classification (Most Common)

**Symptom**: Treating everything as Type 1
**Impact**: Slow decisions, missed opportunities, innovation stagnation
**Fix**: Default to Type 2 unless specific irreversibility criteria met

### Under-Classification

**Symptom**: Rushing irreversible decisions
**Impact**: Costly mistakes, rework, reputation damage
**Fix**: When uncertain, score the dimensions explicitly

### False Reversibility

**Symptom**: "We can always change it later" without considering cost
**Impact**: Technical debt accumulation, stranded investments
**Fix**: Explicitly score Reversal Cost dimension

## STOP-LOP-KNOW Triggers

For Type 1 decisions, finalize when:

1. **STOP**: Information gathering has plateaued (diminishing returns)
2. **LOP**: Losing meaningful opportunities by waiting
3. **KNOW**: Clarity has emerged about the right choice

Do NOT wait for 100% certainty on Type 1 decisions—wait for the right moment.

## Audit Trail

All reversibility assessments are logged:

```yaml
assessment:
  session_id: war-room-20260122-143022
  decision: "Database migration strategy"
  dimensions:
    reversal_cost: 5
    time_lock_in: 4
    blast_radius: 5
    information_loss: 4
    reputation_impact: 2
  reversibility_score: 0.80
  decision_type: "Type 1A"
  deliberation_mode: "full_council"
  assessor: "Chief Strategist"
  override: null
  timestamp: "2026-01-22T14:30:22Z"
```
