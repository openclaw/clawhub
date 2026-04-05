---
name: crew-roles
description: Role taxonomy, capability matrix, and role-risk compatibility for agent team members
parent_skill: conjure:agent-teams
category: delegation-framework
estimated_tokens: 200
---

# Crew Roles

## Role Taxonomy

Each team member has a `role` that determines their capabilities and the types of tasks they can be assigned.

| Role | Tools | Focus | Use When |
|------|-------|-------|----------|
| `implementer` | All tools | Code implementation | Building features, fixing bugs |
| `researcher` | Read-only | Investigation, analysis | Codebase exploration, design research |
| `tester` | Read + test execution | Testing, validation | Writing tests, running test suites |
| `reviewer` | Read-only + comment | Code review, quality | Reviewing PRs, auditing code quality |
| `architect` | All tools | Planning, design | System design, architectural decisions |

**Default role**: `implementer` (backward compatible — members without an explicit role are treated as implementers).

## Capability Matrix

| Capability | implementer | researcher | tester | reviewer | architect |
|-----------|:-----------:|:----------:|:------:|:--------:|:---------:|
| Read files | Yes | Yes | Yes | Yes | Yes |
| Write files | Yes | No | No | No | Yes |
| Edit files | Yes | No | No | No | Yes |
| Run tests | Yes | No | Yes | No | Yes |
| Run builds | Yes | No | Yes | No | Yes |
| Git operations | Yes | No | No | No | Yes |
| Create tasks | Yes | No | No | Yes | Yes |
| Send messages | Yes | Yes | Yes | Yes | Yes |
| Plan mode | Optional | No | No | No | Required |

## Role-Risk Compatibility

Not all roles can handle all risk tiers. The lead validates compatibility before assigning tasks:

| Risk Tier | Allowed Roles | Additional Requirement |
|-----------|--------------|----------------------|
| **GREEN** | Any role | None |
| **YELLOW** | implementer, tester, architect | None |
| **RED** | implementer, architect | Lead oversight required |
| **CRITICAL** | architect only | Human approval required |

**Rationale:**
- GREEN tasks are safe for anyone, including researchers and reviewers
- YELLOW tasks need write access (implementer/architect) or test execution (tester)
- RED tasks need experienced agents with full tool access and active lead monitoring
- CRITICAL tasks need the most strategic role (architect) with human sign-off

## Role Assignment

### At Spawn Time

Roles are assigned when spawning teammates:

```bash
claude --agent-id "backend@my-team" \
       --agent-name "backend" \
       --agent-role "implementer" \
       --team-name "my-team" \
       ...
```

### Dynamic Role Change

Roles can be changed during execution via team config update:

```json
{
  "agent_id": "backend@my-team",
  "role": "reviewer"
}
```

Role changes take effect immediately. The lead should reassign any in-progress tasks that are incompatible with the new role.

## Role-Based Task Routing

When the lead assigns tasks, it should consider role compatibility:

```
For each pending task:
  1. Determine task risk tier (from metadata or classify)
  2. Filter available agents by role-risk compatibility
  3. Prefer agents whose role matches the task type:
     - Implementation tasks → implementer
     - Research/investigation → researcher
     - Test writing/validation → tester
     - Code review → reviewer
     - Architecture/planning → architect
  4. Assign to best-fit available agent
```
