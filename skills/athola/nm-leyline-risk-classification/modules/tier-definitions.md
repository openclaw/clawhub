---
name: tier-definitions
description: 4-tier risk model definitions, boundary criteria, and manual override mechanism
parent_skill: leyline:risk-classification
category: infrastructure
estimated_tokens: 250
---

# Tier Definitions

## Tier Table

### GREEN — Safe

**Scope**: Single file, trivially reversible (`git checkout -- <file>`)

**Criteria:**
- Changes confined to a single file
- No user-visible behavior change (or change is additive-only)
- Easily reverted with a single git operation
- No security, data, or infrastructure implications

**Typical files**: Tests, documentation, utility functions, comments, type annotations, formatting

**Verification**: None required

---

### YELLOW — Caution

**Scope**: Module-level changes, user-visible modifications

**Criteria:**
- Changes affect multiple files within a single module
- User-visible behavior changes (UI, API responses, CLI output)
- Revertible but requires coordination (multiple files to revert)
- No security or data integrity implications

**Typical files**: Components, routes, views, service layer methods, configuration

**Verification**: Conflict check + test pass

---

### RED — Danger

**Scope**: Cross-module changes, security-sensitive, data-affecting

**Criteria:**
- Changes span multiple modules or architectural boundaries
- Security implications (authentication, authorization, encryption)
- Data integrity implications (schema changes, data transformations)
- Complex revert requiring migration or data recovery

**Typical files**: Database migrations, authentication modules, encryption, API schemas, shared types

**Verification**: War-room-checkpoint RS scoring + full test suite + code review

---

### CRITICAL — Stop

**Scope**: Irreversible changes, regulated operations, production impact

**Criteria:**
- Destructive operations that cannot be undone (data deletion, table drops)
- Production deployment or infrastructure changes
- Regulatory or compliance implications
- Changes to security credentials or access controls

**Typical files**: Production configs, data deletion scripts, deployment manifests, security credentials, compliance-related code

**Verification**: War-room-checkpoint RS scoring + human approval before execution

## File Pattern Heuristics per Tier

See `heuristic-classifier.md` for the full pattern-to-tier mapping.

## Override Mechanism

### Manual Escalation

Any task can be manually escalated to a higher tier:

```json
{
  "metadata": {
    "risk_tier": "RED",
    "risk_override": {
      "original_tier": "YELLOW",
      "escalated_by": "team-lead",
      "reason": "This component handles PII data"
    }
  }
}
```

**Rules:**
- Escalation (lower → higher) is always permitted
- De-escalation (higher → lower) requires explicit justification
- CRITICAL can only be de-escalated by human decision
- Override reason is mandatory and logged

### Automatic Escalation

The classifier automatically escalates when:
- File count exceeds module boundary (YELLOW → RED)
- Security-sensitive imports detected in any file (→ RED minimum)
- Destructive operations detected in any file (→ CRITICAL)
- Task modifies files across 3+ top-level directories (→ RED minimum)
