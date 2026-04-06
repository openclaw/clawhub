# Architecture Decision Record (ADR) Patterns

## ADR Template Structure

Every ADR must follow a consistent Markdown template with these required sections:

### Required Sections

1. **Title**
   - Format: `ADR-{number}: {Brief Decision Description}`
   - Example: `ADR-001: Use PostgreSQL for primary data store`

2. **Status**
   - One of: Proposed, Accepted, Deprecated, Superseded
   - Include date when status changed

3. **Context**
   - Forces driving the decision
   - Constraints that must be satisfied
   - Prior art or existing patterns
   - Why this decision is needed now

4. **Decision**
   - The chosen option with clear justification
   - Specific implementation approach
   - Rationale for why this solves the context

5. **Alternatives Considered**
   - Other options evaluated
   - Why each alternative was rejected
   - Trade-offs between options

6. **Consequences**
   - Positive outcomes expected
   - Negative outcomes or limitations
   - Impact on other components or teams
   - Future implications

7. **Metadata**
   - Author(s)
   - Date created
   - Approvers (if required)
   - Links to related documents

## Status Flow

ADRs follow this lifecycle:

```
Proposed → Accepted → [Deprecated | Superseded]
```

- **Proposed**: Draft ADR under review
- **Accepted**: Decision approved and implemented
- **Deprecated**: No longer recommended but not replaced
- **Superseded**: Replaced by a newer ADR (reference the new ADR number)

## Immutability Rules

ADRs are treated like code:

1. **Draft during planning**: Create ADR before implementation begins
2. **Review via pull request**: ADRs go through same review process as code
3. **Immutable once accepted**: Never edit an accepted ADR's decision
4. **Supersede, don't modify**: Create new ADR to change direction

## Superseding an ADR

When replacing an existing decision:

1. Create new ADR with next sequential number
2. Reference the superseded ADR number in context
3. Explain what changed and why the shift occurred
4. Update old ADR status to "Superseded by ADR-{new-number}"
5. Add link in old ADR to new record

## Location Conventions

ADRs typically live in one of these locations:
- `wiki/architecture/`
- `docs/adr/`
- `architecture/decisions/`

Check project structure to determine the established location before creating ADRs.

## Best Practices

### Keep Focused
- One architectural decision per ADR
- Maximum 1-2 pages in length
- Don't combine multiple decisions

### Maintain Traceability
- Link to requirements documents
- Reference design documents
- Connect to related ADRs
- Include issue/ticket numbers

### Write Grounded Content
- Reference specific technologies, tools, or approaches
- Include concrete examples where helpful
- Avoid abstract language or filler
- Use imperative mood for clarity

### Review Checklist
- [ ] Single focused decision
- [ ] All required sections present
- [ ] Alternatives documented with rationale
- [ ] Consequences (both positive and negative) identified
- [ ] Links to related work included
- [ ] Status clearly marked
- [ ] Location follows project convention
