---
name: deliberation-protocol
description: Phase definitions and flow control for War Room deliberation sessions
category: war-room-module
tags: [protocol, phases, workflow]
dependencies: []
estimated_tokens: 800
---

# Deliberation Protocol

## Session Lifecycle

```
Initialize
    |
    v
+------------------------+
| Phase 0: Reversibility |  <-- Chief Strategist (immediate)
| Assessment             |
+------------------------+
    |
    +---> [RS ≤ 0.40: EXPRESS MODE - skip to Phase 7]
    |
    v
+-------------------+
| Phase 1: Intel    |  <-- Scout + Intel Officer (parallel)
+-------------------+
    |
    v
+-------------------+
| Phase 2: Assess   |  <-- Chief Strategist
+-------------------+
    |
    v
+-------------------+
| Phase 3: COA Dev  |  <-- Multiple experts (parallel, anonymized)
+-------------------+
    |
    v
+-------------------+
| Escalation Check  |  <-- Supreme Commander decides
+-------------------+
    |
    +---> [Escalate to Full Council if needed]
    |
    v
+-------------------+
| Phase 4: Red Team |  <-- Red Team Commander
+-------------------+
    |
    v
+-------------------+
| Phase 5: Voting   |  <-- All active experts
+-------------------+
    |
    v
+-------------------+
| Phase 6: Premortem|  <-- All active experts (parallel)
+-------------------+
    |
    v
+-------------------+
| Phase 7: Synthesis|  <-- Supreme Commander
+-------------------+
    |
    v
Persist to Strategeion
```

## Phase Definitions

### Phase 0: Reversibility Assessment

**Purpose**: Determine appropriate deliberation intensity before committing resources.

**Expert**: Chief Strategist (Sonnet)

**Execution**: Immediate, before any other phases

**Inputs**:
- Problem statement
- Initial context

**Step 0a: Threshold Configuration** (optional)

Prompt user for custom thresholds:
```
Reversibility Thresholds (Enter for defaults):
  Express ceiling    [0.40]: _
  Lightweight ceiling [0.60]: _
  Full Council ceiling [0.80]: _
```

If user presses Enter, use defaults. Otherwise, apply custom thresholds for session.

**Step 0b: Dimension Scoring**

Score five dimensions (1-5 each):
1. **Reversal Cost** - Effort to undo the decision
2. **Time Lock-In** - How quickly decision crystallizes
3. **Blast Radius** - Scope of systems/people affected
4. **Information Loss** - Options closed by deciding
5. **Reputation Impact** - External visibility and trust implications

**Outputs**:
- Reversibility Score (RS) = Sum / 25
- Decision Type classification (Type 2, 1B, 1A, 1A+)
- Recommended deliberation mode (using configured thresholds)
- Justification for classification

**Duration Target**: 15-30 seconds (including threshold prompt)

**Routing Logic** (using configured or default thresholds):
```
# t = user thresholds or defaults {express: 0.40, lightweight: 0.60, full_council: 0.80}

if RS <= t.express:
    mode = "express"  # Skip to Phase 7 (Synthesis only)
elif RS <= t.lightweight:
    mode = "lightweight"  # Standard 2-round protocol
elif RS <= t.full_council:
    mode = "full_council"  # Invoke all experts
else:
    mode = "full_council_delphi"  # Iterative convergence
```

**Express Mode Fast Path**:
For Type 2 decisions (RS ≤ 0.40):
- Skip Phases 1-6
- Chief Strategist provides immediate recommendation
- Supreme Commander ratifies or overrides
- Total time: < 2 minutes

---

### Phase 1: Intelligence Gathering

**Purpose**: Gather context and identify terrain before strategy.

**Experts**: Scout (Qwen Turbo), Intelligence Officer (Gemini Pro)

**Execution**: Parallel

**Inputs**:
- Problem statement
- Context files (if provided)

**Outputs**:
- Scout Report (quick terrain overview)
- Intelligence Report (deep analysis)

**Duration Target**: 30-60 seconds

### Phase 2: Situation Assessment

**Purpose**: Synthesize intelligence into actionable assessment.

**Expert**: Chief Strategist (Sonnet)

**Execution**: Sequential (after Phase 1)

**Inputs**:
- All intelligence reports from Phase 1

**Outputs**:
- Refined problem statement
- Prioritized constraints
- Strategic opportunities
- COA development guidance

**Duration Target**: 15-30 seconds

### Phase 3: COA Development

**Purpose**: Generate diverse courses of action.

**Experts**: Variable (based on mode)
- Lightweight: Chief Strategist only
- Full Council: Strategist + Tactician + Logistics Officer

**Execution**: Parallel, anonymized

**Inputs**:
- Situation assessment from Phase 2

**Outputs**:
- 3-5 distinct COAs
- Each with pros, cons, risks, effort estimate

**Duration Target**: 60-120 seconds

**Anonymization**: Responses labeled as "Response A, B, C..."

### Escalation Check

**Purpose**: Supreme Commander validates Phase 0 classification or overrides.

**Automatic Escalation** (based on RS from Phase 0):
- RS > 0.60 → Full Council activated
- RS > 0.80 → Delphi mode enabled

**Manual Escalation Triggers**:
1. High complexity (multiple architectural trade-offs)
2. Significant expert disagreement (conflicting COAs)
3. Novel problem domain (uncertain reversibility)
4. Precedent-setting decision (future decisions follow pattern)
5. User explicitly requested full council

**De-escalation Opportunity**:
If Phase 0 classified as Type 1 but evidence suggests Type 2:
- Challenge the RS assessment
- Document false irreversibility claim
- Recommend express mode

**If Escalated**:
- Invoke additional experts (Intel Officer, Tactician, Logistics)
- Gather additional COAs
- Merge with existing COAs
- Update RS assessment with new information

### Phase 4: Red Team + Wargaming

**Purpose**: Challenge assumptions and identify weaknesses.

**Expert**: Red Team Commander (Gemini Flash)

**Execution**: Sequential (after all COAs)

**Inputs**:
- All COAs (anonymized)
- Situation assessment

**Outputs**:
- Challenge report per COA
- Hidden assumptions identified
- Failure scenarios
- Cross-cutting concerns

**Duration Target**: 30-60 seconds

### Phase 5: Voting + Narrowing

**Purpose**: Aggregate expert rankings to identify top approaches.

**Experts**: All active experts

**Execution**: Parallel

**Inputs**:
- All COAs with Red Team challenges

**Outputs**:
- Expert rankings
- Aggregate scores (Borda count)
- Top 2-3 finalists

**Voting Method**: Borda count (rank-based scoring)

**Duration Target**: 30-45 seconds

### Phase 6: Premortem Analysis

**Purpose**: Imagine failure to identify risks.

**Experts**: All active experts

**Execution**: Parallel

**Inputs**:
- Selected COA(s) from voting

**Outputs**:
- Failure mode catalog
- Early warning signs
- Prevention strategies
- Contingency plans

**Duration Target**: 45-90 seconds

### Phase 7: Supreme Commander Synthesis

**Purpose**: Make final decision with full rationale.

**Expert**: Supreme Commander (Opus)

**Execution**: Sequential (final phase)

**Inputs**:
- All deliberation artifacts
- Full attribution (unsealed)

**Outputs**:
- Selected approach
- Detailed rationale
- Implementation orders
- Watch points
- Dissenting views acknowledged

**Duration Target**: 30-60 seconds

## Delphi Extension

For high-stakes decisions, iterate until convergence:

```
Round N:
  - Experts revise positions based on Red Team feedback
  - Re-vote
  - Check convergence score

Convergence Formula:
  score = 1 - (std_dev(rankings) / max_possible_std_dev)

Threshold: 0.85 (configurable)
Max Rounds: 5 (configurable)
```

## Error Handling

### Expert Failure

If an expert fails to respond:
1. Log the failure with reason
2. Continue with remaining experts
3. Note gap in synthesis
4. Do not block deliberation

### Timeout Handling

Default timeouts:
- External experts: 120 seconds
- Synthesis phases: 180 seconds

On timeout:
1. Use partial response if available
2. Log timeout event
3. Continue deliberation

### Session Recovery

Sessions are persisted after each phase:
- Can resume from last completed phase
- Use `--resume <session-id>` to continue

## Agent Teams Execution Path

When `--agent-teams` is active (Full Council / Delphi only), phases execute through persistent teammates instead of one-shot delegations:

### Phase Mapping

| Phase | Standard (Conjure) | Agent Teams |
|-------|-------------------|-------------|
| Phase 0: RS Assessment | Chief Strategist direct call | Lead agent computes directly (no team needed yet) |
| Phase 1: Intel | Parallel delegation to Scout + Intel | Lead sends inbox tasks to `scout` + `intel-officer` teammates |
| Phase 2: Assessment | Sequential delegation | Lead's `chief-strategist` teammate processes intel reports |
| Phase 3: COA Dev | Parallel delegation, anonymized | Teammates develop COAs independently; can send clarifying questions via inbox |
| Phase 4: Red Team | Sequential delegation | `red-team` teammate receives COAs; **can message authors for clarification** |
| Phase 5: Voting | Parallel delegation | Lead broadcasts ballot; teammates respond via inbox messages |
| Phase 6: Premortem | Parallel delegation | Teammates post failure scenarios; **can build on each other's analysis** |
| Phase 7: Synthesis | Supreme Commander call | Lead agent synthesizes (teammates shut down after) |

### Key Differences

**Bidirectional messaging** (Phases 3-6): In standard mode, experts produce one-shot responses. In agent teams mode, experts can exchange messages mid-phase — the Red Team can ask a COA author to clarify assumptions, and premortem participants can chain failure scenarios.

**Delphi persistence**: In standard mode, each Delphi round re-invokes all experts from scratch. In agent teams mode, teammates persist across rounds, retaining prior context and positions. This reduces token waste and enables more nuanced position evolution.

**Anonymization**: Agent teams still uses anonymized COA labeling (Response A, B, C) during Phases 3-5. Attribution is revealed in Phase 7 by the lead agent after de-anonymization.

### Graceful Shutdown

After Phase 7, the lead sends `shutdown_request` to all teammates. Teammates acknowledge and exit. Lead cleans up team config and tmux panes.

## Metrics

Track per session:
- **Reversibility Score** (from Phase 0)
- **Decision Type** (Type 2, 1B, 1A, 1A+)
- **Mode match** (did actual mode match RS recommendation?)
- Total duration
- Per-phase duration
- Token usage per expert
- Expert failure count
- Escalation occurred (y/n)
- De-escalation occurred (y/n)
- Convergence rounds (if Delphi)
- **Over-deliberation rate** (sessions where RS suggested lighter mode)
