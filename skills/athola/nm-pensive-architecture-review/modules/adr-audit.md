---
name: adr-audit
description: Architecture Decision Record audit patterns and verification workflows
parent_skill: pensive:architecture-review
category: architecture
tags: [adr, documentation, governance, decisions]
complexity: intermediate
estimated_tokens: 400
---

# ADR Audit Module

detailed ADR discovery, validation, and governance patterns.

## ADR Location Patterns

Common ADR locations by project type:

```bash
# Standard locations
wiki/architecture/
docs/adr/
docs/decisions/
architecture/decisions/
.adr/

# Search pattern
find . -type f -name "*ADR*" -o -name "*decision*" | grep -E "\.(md|txt)$"
```

## Required ADR Sections

Every ADR must include:

### 1. Title
Clear, specific decision statement:
- "Use PostgreSQL for primary datastore"
- "Adopt hexagonal architecture pattern"
- "Implement JWT-based authentication"

### 2. Status
Must follow strict progression:
```
Proposed → Reviewed → Accepted
                    ↓
              Superseded (when invalidated)
```

**Rules:**
- Status changes are append-only
- Date each status transition
- Never delete/modify accepted ADRs
- Use "Superseded by ADR-XXX" to replace

### 3. Context
Document the forces at play:
- Business requirements
- Technical constraints
- Team capabilities
- Timeline pressures
- Existing architecture

### 4. Decision
The "we will..." statement:
- Clear action chosen
- Implementation approach
- Key design choices

### 5. Alternatives Considered
For each alternative:
- Description
- Pros/cons
- Why rejected

Minimum 2 alternatives required.

### 6. Consequences

**Positive:**
- Benefits gained
- Problems solved
- Capabilities enabled

**Negative:**
- Trade-offs accepted
- Technical debt incurred
- Complexity added

**Neutral:**
- Changes required
- Migration steps
- Training needs

### 7. Metadata
```yaml
Date: YYYY-MM-DD
Author: [name]
Status: [status]
Supersedes: [ADR-XXX] (if applicable)
Superseded-by: [ADR-XXX] (if applicable)
```

## Status Flow Verification

### Valid Transitions
- Proposed → Reviewed
- Reviewed → Accepted
- Reviewed → Rejected
- Accepted → Superseded (via new ADR only)

### Invalid Transitions
- Proposed -> Accepted (skip review)
- Accepted -> Rejected (use Superseded)
- Superseded -> Accepted (immutable)

## Immutability Rules

**Once Accepted:**
1. **Never modify** decision content
2. **Never change** consequences
3. **Never delete** the ADR
4. **Only append** status changes

**To Replace:**
1. Create new ADR with superseding decision
2. Add "Supersedes: ADR-XXX" to new ADR
3. Add "Superseded-by: ADR-YYY" to old ADR
4. Update old ADR status to "Superseded"

## Audit Workflow

### 1. Locate All ADRs
```bash
# Find ADR directory
ls -la docs/adr/ wiki/architecture/ 2>/dev/null

# Count ADRs
find . -path "*/adr/*.md" -o -path "*/decisions/*.md" | wc -l
```

### 2. Verify Structure
For each ADR:
- [ ] Has all required sections
- [ ] Status follows valid flow
- [ ] Dates are present
- [ ] Alternatives documented (≥2)
- [ ] Consequences specified

### 3. Check References
```bash
# Find ADR references in code
grep -r "ADR-[0-9]" --include="*.md" --include="*.py" --include="*.js"

# Verify backlinks
grep "Superseded-by" docs/adr/*.md
```

### 4. Flag Issues
Common problems:
- Missing sections
- Invalid status transitions
- Modified accepted ADRs
- Missing supersession links
- Insufficient alternatives

## New ADR Requirements

Flag need for new ADR when:
- Introducing new architectural pattern
- Changing core technology
- Modifying system boundaries
- Adding external dependencies
- Changing security model

**Before implementation:**
1. Draft ADR with all sections
2. Set status: Proposed
3. Request review
4. Update to Reviewed
5. Gain approval → Accepted
6. Then proceed with implementation

## Integration with Architecture Review

Use this module during Step 2 (ADR Audit):
1. Locate ADRs using patterns
2. Verify structure completeness
3. Check status flow validity
4. Confirm immutability compliance
5. Identify missing ADRs for current work
6. Draft new ADRs if needed
