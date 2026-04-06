# Readiness Levels: 4-Tier Risk Classification

A graduated risk system with required controls at each level.

## Purpose

Readiness Levels classify tasks by risk level before execution.
Higher levels require more controls, verification, and oversight.
This prevents high-risk changes from being treated casually and
ensures appropriate safeguards are in place.

## Quick Classification

Ask these questions in order. Stop at the first "yes":

1. **Is the action irreversible?** → Level 3 (Critical)
2. **Does it involve security/compliance/data integrity?** → Level 2 (Elevated)
3. **Is it user-visible or affects multiple files?** → Level 1 (Watch)
4. **Otherwise** → Level 0 (Routine)

## When to Apply

Apply Readiness Levels when:

- Starting any task that modifies code or configuration
- Planning parallel agent work (determine verification needs)
- Reviewing PRs (check that controls match the level)
- Before executing any task marked in an implementation plan

Do NOT apply when:

- The change is documentation-only with no code implications
- The work is purely exploratory with no production impact
- You're just reading files (no modification)

## Getting Started

1. Assess the task using the Quick Classification questions
2. Find the matching level in Level Definitions below
3. Check all required controls listed for that level
4. Document any additional controls you choose to add
5. Never skip required controls; you may add optional ones

## Why Four Levels

Four levels balance granularity with usability:

- **Too few levels**: Can't distinguish between "needs review" and
  "needs human approval"
- **Too many levels**: People stop using the system because it's
  too complex

The 0-3 scale maps naturally to: Routine/Watch/Elevated/Critical.
Each level has a clear escalation trigger and distinct required
controls. The gap between levels is meaningful, not arbitrary.

This pattern emerged from observing that teams with simple,
actionable risk frameworks actually use them, while teams with
complex matrices create work that everyone ignores.

## Level Definitions

### Level 0: Routine

**When to use**:

- Low blast radius (changes affect single file or function)
- Easy rollback (simple git revert or file restore)
- No user-visible changes
- No data integrity implications

**Required controls**:

- [ ] Basic validation (tests pass, lint clean)
- [ ] Rollback step documented (even if trivial)

**Example tasks**:

- Adding a new utility function
- Updating internal documentation
- Refactoring a single function's internals
- Adding a new test case

### Level 1: Watch

**When to use**:

- User-visible changes (UI, API, behavior)
- Moderate impact (affects multiple files or users)
- Configuration changes
- Dependency version updates

**Required controls**:

- [ ] Independent review (code review or pair programming)
- [ ] Negative test (verify what shouldn't happen doesn't happen)
- [ ] Rollback note (how to revert, estimated impact)
- [ ] Risk assessment checklist completed

**Example tasks**:

- Adding a new API endpoint
- Changing error messages
- Updating a dependency
- Modifying configuration files

### Level 2: Elevated

**When to use**:

- Security implications (auth, encryption, permissions)
- Compliance requirements (audit logging, data retention)
- Data integrity (migrations, schema changes)
- Performance-critical paths

**Required controls**:

- [ ] Adversarial review (challenge the approach)
- [ ] Risk assessment checklist completed and reviewed
- [ ] Go/no-go checkpoint (explicit approval before proceeding)
- [ ] Staged rollout plan (canary, gradual, or feature flag)
- [ ] Monitoring/alerting in place for production

**Example tasks**:

- Changing authentication flow
- Database schema migration
- Adding audit logging
- Performance optimization in hot path

### Level 3: Critical

**When to use**:

- Irreversible actions (data deletion, contract changes)
- Regulated domains (healthcare, finance, PII)
- Safety-sensitive systems (infrastructure, access control)
- Major architectural changes

**Required controls**:

- [ ] Minimal scope (smallest possible change)
- [ ] Human confirmation (explicit user approval, not automated)
- [ ] Two-step verification (separate approval and execution)
- [ ] Contingency plan (what if it goes wrong despite controls)
- [ ] Dry run or simulation if possible
- [ ] Stakeholder notification

**Example tasks**:

- Deleting user data
- Changing payment processing
- Modifying access control rules
- Infrastructure changes affecting production

## Level Selection Decision Tree

```
START
  │
  ├─ Is the action irreversible? ────────────────── YES ─→ Level 3
  │
  ├─ Does it involve security/compliance/data? ─── YES ─→ Level 2
  │
  ├─ Is it user-visible or multi-file? ─────────── YES ─→ Level 1
  │
  └─ Otherwise ──────────────────────────────────────────→ Level 0
```

## Risk Assessment Checklist

Required for Level 1 and above. Answer these questions before
proceeding:

1. **What could fail in production?**
   - List specific failure scenarios

2. **How would we detect it quickly?**
   - Monitoring, alerts, user reports

3. **What is the fastest safe rollback?**
   - Specific commands or steps

4. **What dependency could invalidate this plan?**
   - External services, data sources, assumptions

5. **What assumption is least certain?**
   - What might we be wrong about

Document answers in the task notes or commit message.

## Integration Points

### With attune:war-room-checkpoint

Tasks classified as Level 2 or 3 should trigger a war-room
checkpoint before execution:

```
if readiness_level >= 2:
    invoke Skill(attune:war-room-checkpoint)
```

### With leyline:damage-control

Level 1+ tasks should have risk assessment checklist answers
documented before marking complete:

```
if readiness_level >= 1:
    require risk_assessment_checklist in task_notes
```

### With egregore:quality-gate

Quality gates should verify controls are present based on
level:

```
verify_controls(readiness_level):
    if level >= 0: require basic_validation
    if level >= 1: require review, negative_test, rollback_note
    if level >= 2: require adversarial_review, go_no_go
    if level >= 3: require human_confirmation, two_step
```

## Level Escalation

Tasks may be escalated to a higher level if:

- New information reveals higher risk
- Scope expands beyond original assessment
- Dependencies introduce complexity
- User requests additional caution

Never de-escalate without explicit user approval.

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│ READINESS LEVELS QUICK REFERENCE                            │
├─────────┬──────────────────────────────────────────────────┤
│ Level   │ 0 Routine   │ 1 Watch    │ 2 Elevated│ 3 Critical│
├─────────┼──────────────┼────────────┼───────────┼───────────┤
│ Blast   │ Low          │ Moderate   │ High      │ Critical  │
│ Rollback│ Easy         │ Possible   │ Complex   │ Difficult │
│ Review  │ Self         │ Peer       │ Adversary │ Stakehold │
│ Approve │ Auto         │ Reviewer   │ Checkpt   │ Human 2stp│
└─────────┴──────────────┴────────────┴───────────┴───────────┘
```

## Mapping to Existing Risk Tiers

| Readiness Level | Existing Tier | Color |
|-----------------|---------------|-------|
| 0 Routine | GREEN | Safe |
| 1 Watch | YELLOW | Caution |
| 2 Elevated | RED | Danger |
| 3 Critical | CRITICAL | Stop |

Use Readiness Levels for new documentation. The existing
GREEN/YELLOW/RED/CRITICAL system remains for backward
compatibility.
