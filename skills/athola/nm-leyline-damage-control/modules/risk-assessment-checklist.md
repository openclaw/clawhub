# Risk Assessment Checklist

Pre-execution checklist for Level 1+ tasks.

## Purpose

The risk assessment checklist forces explicit consideration of what
could go wrong before execution begins. It prevents optimistic
planning and ensures mitigation strategies are in place.
Required for all Level 1 (Watch) and above tasks.

## When to Use

Complete this checklist when:

- Task is classified as Level 1 (Watch) or higher
- You're about to modify production-affecting code
- The change touches security, data integrity, or user-facing APIs
- You feel uncertain about the scope of impact

Do NOT complete when:

- Task is Level 0 (Routine) with trivial impact
- The work is documentation-only
- You're just reading files, not modifying

## Getting Started

1. Classify the task's Readiness Level first
2. If Level 1+, copy the template below
3. Answer all five questions before starting work
4. Get review if Level 2+ (peer or adversarial)
5. Keep the completed checklist with your task notes
6. Reference it if something goes wrong

## Why Five Questions

The five questions cover the essential risk dimensions:

1. **Failure modes** - What breaks?
2. **Detection** - How do we know it broke?
3. **Rollback** - How do we fix it?
4. **Dependencies** - What else could break it?
5. **Assumptions** - What are we guessing about?

These five emerged from post-mortem analysis of production
incidents. The most common root causes were: not anticipating the
failure mode, not having detection, not knowing how to roll back,
dependency failures, and invalid assumptions.

Each question has a mitigation purpose:
- Question 1 → Design for failure
- Question 2 → Monitoring and alerting
- Question 3 → Recovery planning
- Question 4 → Dependency awareness
- Question 5 → Humility about unknowns

## The Five Questions

Before executing any Level 1+ task, answer these questions:

### 1. What could fail in production?

Think through specific failure scenarios:

- **Data corruption**: Could this change corrupt or lose data?
- **Service degradation**: Could this cause slowdowns or outages?
- **Security breach**: Could this expose sensitive information?
- **Integration breakage**: Could this break dependent systems?
- **User impact**: Could this negatively affect user experience?

**Document**: List 2-5 specific failure modes relevant to this
task.

**Example**:

```
Failure modes for "Add rate limiting to API":
1. Rate limiter incorrectly blocks legitimate users
2. Redis unavailability causes all requests to fail
3. Rate limit state inconsistency across instances
4. Performance degradation from rate limit checks
```

### 2. How would we detect it quickly?

Define detection mechanisms:

- **Monitoring**: What metrics would show the problem?
- **Alerting**: What alerts should fire?
- **Logging**: What log patterns indicate failure?
- **User reports**: How would users report issues?
- **Health checks**: What health check failures would occur?

**Document**: List specific detection mechanisms.

**Example**:

```
Detection mechanisms:
- Alert: "Rate limit rejection rate > 5%"
- Alert: "Redis connection errors > 0"
- Metric: Request latency P99
- Log pattern: "Rate limit exceeded" for known-good users
- Health check: Redis connectivity check
```

### 3. What is the fastest safe rollback?

Define the rollback procedure:

- **Code rollback**: Git revert, deploy previous version
- **Config rollback**: Restore previous configuration
- **Data rollback**: Restore from backup, run migration reversal
- **Feature flag**: Disable the feature
- **Dependency rollback**: Revert to previous version

**Document**: Step-by-step rollback procedure with time estimate.

**Example**:

```
Rollback procedure:
1. Set feature flag RATE_LIMIT_ENABLED=false (30 seconds)
2. If Redis issues, remove rate limit middleware (2 minutes)
3. Full code rollback: git revert HEAD && deploy (5 minutes)

Fastest safe rollback: Feature flag disable (30 seconds)
```

### 4. What dependency could invalidate this plan?

Identify external dependencies and their failure impact:

- **External APIs**: What if they change or go down?
- **Infrastructure**: What if servers, databases, caches fail?
- **Dependencies**: What if libraries have bugs or vulnerabilities?
- **Assumptions**: What if our assumptions are wrong?
- **Timing**: What if this takes longer than expected?

**Document**: List dependencies and their potential issues.

**Example**:

```
Dependencies and risks:
- Redis: Single point of failure, need fallback behavior
- API documentation: If outdated, rate limit logic may be wrong
- Load testing tool: If inaccurate, may miss production patterns
- Time: If delays occur, may need to ship without full testing
```

### 5. What assumption is least certain?

Identify the weakest link in the plan:

- **User behavior**: Are we sure users will behave as expected?
- **Performance**: Are performance assumptions validated?
- **Scale**: Will this work at production scale?
- **Compatibility**: Are we sure about version compatibility?
- **Documentation**: Is the documentation we're relying on accurate?

**Document**: Identify the assumption most likely to be wrong.

**Example**:

```
Least certain assumption:
"We can accurately rate limit based on IP address"

Why uncertain:
- Users behind corporate NATs share IPs
- Mobile users have changing IPs
- Attackers can rotate IPs

Mitigation:
- Consider user-ID based limiting in addition to IP
- Plan to iterate based on production data
```

## Checklist Template

```markdown
## Risk Assessment Checklist

**Task**: [Task description]
**Readiness Level**: [0/1/2/3]
**Date**: [Date]

### 1. What could fail in production?

- [Failure mode 1]
- [Failure mode 2]
- [Failure mode 3]

### 2. How would we detect it quickly?

- [Detection mechanism 1]
- [Detection mechanism 2]
- [Detection mechanism 3]

### 3. What is the fastest safe rollback?

Steps:
1. [Step 1]
2. [Step 2]
3. [Step 3]

Estimated time: [X minutes]

### 4. What dependency could invalidate this plan?

- [Dependency 1]: [Risk]
- [Dependency 2]: [Risk]
- [Dependency 3]: [Risk]

### 5. What assumption is least certain?

Assumption: [The assumption]
Why uncertain: [Reason]
Mitigation: [Plan B]

---

Reviewed by: [Name]
Date: [Date]
```

## Completed Example

```markdown
## Risk Assessment Checklist

**Task**: Add JWT authentication to API
**Readiness Level**: 2
**Date**: 2024-03-20

### 1. What could fail in production?

- Token validation fails for valid users (blocks access)
- Private key leaked (security breach)
- Token expiration too short (user frustration)
- Clock skew causes validation failures
- Algorithm confusion attack succeeds

### 2. How would we detect it quickly?

- Alert: "Authentication failure rate > 2%"
- Alert: "Token validation latency > 100ms"
- Log pattern: "Invalid token" for known user IDs
- Metric: Active session count drops unexpectedly
- User reports: Login issues in support tickets

### 3. What is the fastest safe rollback?

Steps:
1. Set AUTH_MODE=session (feature flag, 30 seconds)
2. Remove JWT middleware from routing (1 minute)
3. Full revert: git revert HEAD~3 && deploy (5 minutes)

Estimated time: 30 seconds (feature flag)

### 4. What dependency could invalidate this plan?

- JWT library: Could have vulnerability, pin version
- Key management: If key rotation fails, old tokens invalid
- Time synchronization: NTP issues cause validation failures
- Token size: If too large, may exceed header limits

### 5. What assumption is least certain?

Assumption: "RS256 is the correct algorithm choice"

Why uncertain: We haven't validated key management
infrastructure exists or works at our scale.

Mitigation: Start with HS256 (simpler) for initial rollout,
plan RS256 migration once key management is proven.

---

Reviewed by: Security Team
Date: 2024-03-20
```

## Integration Points

### With Readiness Levels

| Level | Required | Review Level |
|-------|----------|--------------|
| 0 (Routine) | No | N/A |
| 1 (Watch) | Yes | Self-review |
| 2 (Elevated) | Yes | Peer review |
| 3 (Critical) | Yes | Adversarial review |

### With damage-control

When damage-control is invoked, reference the risk assessment
checklist:

1. Was the failure mode anticipated?
2. Did detection mechanisms work?
3. Was rollback procedure followed?
4. Did dependencies fail as expected?
5. Was the uncertain assumption the cause?

### With quality-gate

Quality gates verify checklist completion:

```
if readiness_level >= 1:
    require risk_assessment_checklist in task_notes
    if readiness_level >= 2:
        require checklist_peer_review
```

## Anti-Patterns

### Anti-Pattern 1: Copy-Paste Checklist

```
# BAD: Generic checklist that doesn't address the task
1. What could fail? "Something might break"
2. Detection? "We'll notice"
3. Rollback? "Revert"
```

```
# GOOD: Specific to the task
1. What could fail? "Redis connection timeout causes all
   requests to fail with 500"
2. Detection? "Alert on 'Redis timeout' log pattern"
3. Rollback? "Disable rate limiting via feature flag in 30s"
```

### Anti-Pattern 2: Post-Hoc Checklist

```
# BAD: Writing checklist after implementation
Implement feature → Write checklist → Deploy

# GOOD: Checklist before implementation
Write checklist → Review → Implement → Verify → Deploy
```

### Anti-Pattern 3: Ignored Checklist

```
# BAD: Checklist documented but not referenced during failure
- Checklist exists
- Failure occurs
- Team scrambles without using checklist

# GOOD: Checklist is the first reference
- Failure occurs
- Team pulls up checklist
- Follows documented rollback procedure
```

## Related References

- `../../risk-classification/modules/readiness-levels.md` - Level
  definitions
- `../SKILL.md` - Error recovery procedures
- `../../egregore/skills/quality-gate/SKILL.md` - Verification requirements
