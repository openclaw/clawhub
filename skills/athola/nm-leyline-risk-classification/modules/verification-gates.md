---
name: verification-gates
description: Per-tier verification requirements and parallel execution safety matrix
parent_skill: leyline:risk-classification
category: infrastructure
estimated_tokens: 250
---

# Verification Gates

## Per-Tier Requirements

### GREEN — No Gates

No verification required. Agent completes task and marks as done.

```
Task complete → Mark completed
```

### YELLOW — Standard Gates

```
Task complete
    → Conflict check (git status, no uncommitted conflicts)
    → Test pass (affected test files + related tests)
    → Mark completed
```

**Conflict check**: Verify no merge conflicts exist with other in-progress tasks. If agent-teams are active, check team inbox for conflict alerts.

**Test pass**: Run tests directly related to changed files. Full test suite not required.

### RED — Enhanced Gates

```
Task complete
    → Invoke Skill(attune:war-room-checkpoint) for RS scoring
    → Full test suite pass
    → Code review (lead agent or human)
    → Mark completed (only after review approval)
```

**War-room-checkpoint**: Produces a Reversibility Score (RS) confirming the risk assessment. If RS is lower than expected, the task may be downgraded.

**Full test suite**: All tests must pass, not just those related to changed files.

**Code review**: Lead agent reviews changes for correctness, security implications, and architectural alignment. For tasks touching auth/security, human review is strongly recommended.

### CRITICAL — Maximum Gates

```
Task complete
    → Invoke Skill(attune:war-room-checkpoint) for RS scoring
    → Human approval REQUIRED (explicit confirmation)
    → Full test suite pass
    → Deployment review (if applicable)
    → Mark completed (only after human approval)
```

**Human approval**: The system must pause and present changes to the human for explicit approval before marking the task complete. No automated bypass.

## Parallel Execution Safety Matrix

Risk tiers constrain which tasks can execute in parallel:

| Task A | Task B | Parallel? | Reason |
|--------|--------|-----------|--------|
| GREEN | GREEN | Yes | Low risk, independent |
| GREEN | YELLOW | Yes | No compounding risk |
| GREEN | RED | Yes | GREEN won't interfere |
| GREEN | CRITICAL | Yes | GREEN won't interfere |
| YELLOW | YELLOW | Yes | Standard caution |
| YELLOW | RED | Yes | With conflict monitoring |
| YELLOW | CRITICAL | No | CRITICAL needs full attention |
| RED | RED | **No** | Compounding risk too high |
| RED | CRITICAL | **No** | Both need careful oversight |
| CRITICAL | CRITICAL | **No** | Never parallel |

### Prohibited Combinations

**RED + RED**: Two high-risk tasks running simultaneously create compounding risk. Merge conflicts between RED tasks could produce dangerous states. Execute sequentially.

**Any + CRITICAL**: CRITICAL tasks require dedicated oversight — only GREEN tasks may run in parallel, since they cannot interfere. All YELLOW, RED, and CRITICAL tasks must wait.

### Conflict Monitoring for Mixed-Tier Parallel

When running YELLOW + RED in parallel:
- Lead monitors for file overlap continuously
- RED task has priority in any conflict
- YELLOW task pauses if conflict detected
- Lead resolves before either continues

## Gate Failure Handling

When a verification gate fails:

| Gate | Failure Action |
|------|---------------|
| Conflict check | Resolve conflicts, re-run gate |
| Test pass | Fix failing tests, re-run gate |
| War-room RS | Re-evaluate risk, potentially escalate |
| Code review | Address feedback, re-submit |
| Human approval | Document rejection reason, revise or abandon |

Gate failures do not automatically escalate the risk tier. The task remains at its classified tier but cannot complete until gates pass.
