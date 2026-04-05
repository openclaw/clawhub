# Specification Structure

## Mandatory Sections

Every specification must include these four sections to be considered complete.

### 1. Overview/Context

**Purpose**: Establish the problem being solved and why it matters.

**What to Include**:
- Problem statement: What pain point does this address?
- Business value: Why invest in this now?
- Target users: Who benefits from this?
- Success definition: What does "done" look like at a high level?

**When to Expand**:
- Complex features touching multiple user personas
- Features requiring stakeholder alignment
- Features with significant business impact

**Template**:
```markdown
## Overview

**Problem**: [1-2 sentences describing the user pain point]

**Value**: [1-2 sentences on business impact or user benefit]

**Users**: [Who uses this feature and in what context]

**Success**: [High-level outcome when complete]
```

**Example**:
```markdown
## Overview

**Problem**: Users abandon checkout because they can't easily review their order before completing purchase.

**Value**: Reducing checkout abandonment by 15% would increase revenue by $2M annually.

**Users**: All e-commerce customers, especially first-time buyers who need confidence before purchase.

**Success**: Checkout completion rate increases and customer support questions about orders decrease.
```

### Assumptions

**Purpose**: Document conditions taken as given that inform this
specification.

**What to Include**:
- Conditions assumed true that, if proven false, would
  invalidate parts of this specification
- Scope boundaries accepted without verification
- Environmental or organizational givens

**Template**:
```markdown
## Assumptions

Explicit assumptions that inform this specification.
Document any conditions taken as given that, if proven
false, would invalidate parts of this specification.

- [List assumptions here]
```

### 2. User Scenarios

**Purpose**: Show how real users interact with the feature in context.

**What to Include**:
- Primary user flows (happy path)
- User motivations and goals
- Starting state and ending state
- Context of use

**When to Expand**:
- Multiple user personas with different needs
- Complex workflows spanning multiple sessions
- Features replacing existing processes

**Template**:
```markdown
## User Scenarios

### Scenario 1: [User Type] - [Goal]
**Context**: [When/why the user needs this]
**Flow**:
1. [User action or starting point]
2. [Next step]
3. [Outcome]

**Expected Result**: [What the user achieves]
```

**Example**:
```markdown
## User Scenarios

### Scenario 1: First-Time Buyer - Review Order Before Purchase
**Context**: User has added items to cart and is ready to checkout but wants to verify everything is correct.

**Flow**:
1. User clicks "Proceed to Checkout" from shopping cart
2. User sees order summary with item details, quantities, and prices
3. User reviews shipping address and payment method
4. User confirms and completes purchase

**Expected Result**: User feels confident they're ordering the right items and has opportunity to catch errors.
```

### 3. Functional Requirements

**Purpose**: Define what the system must do, without specifying how.

**What to Include**:
- Required capabilities (what users can do)
- Data inputs and outputs
- Validation rules
- Business rules
- Integration points (at a high level)

**When to Expand**:
- Features with complex business logic
- Features requiring data transformations
- Features with many validation rules

**Template**:
```markdown
## Functional Requirements

### Core Capabilities
- [ ] The system must [capability]
- [ ] Users can [action]
- [ ] The system will [behavior]

### Validation Rules
- [ ] [Field/input] must [constraint]
- [ ] [Condition] triggers [response]

### Business Rules
- [ ] When [condition], then [outcome]
```

**Example**:
```markdown
## Functional Requirements

### Core Capabilities
- [ ] Users can view complete order summary before final purchase
- [ ] Order summary displays all line items with quantities and prices
- [ ] Users can edit quantities directly from order summary
- [ ] System calculates totals including tax and shipping

### Validation Rules
- [ ] Out-of-stock items must show availability warning
- [ ] Minimum order amount enforced before checkout button enables

### Business Rules
- [ ] Tax calculation based on shipping address
- [ ] Free shipping threshold applies after discounts
```

### 4. Success Criteria

**Purpose**: Define measurable outcomes that prove the feature works.

**What to Include**:
- Quantifiable metrics
- Observable user behaviors
- Performance targets
- Quality thresholds

**When to Expand**:
- Features with performance requirements
- Features affecting business KPIs
- Features requiring A/B testing validation

**Template**:
```markdown
## Success Criteria

### User Outcomes
- [ ] [Percentage] of users [behavior]
- [ ] Users complete [task] in under [time]

### Performance Targets
- [ ] [Operation] completes in under [time]
- [ ] System supports [number] concurrent [users/operations]

### Quality Metrics
- [ ] [Metric] improves by [percentage]
- [ ] Error rate below [threshold]
```

**Example**:
```markdown
## Success Criteria

### User Outcomes
- [ ] 90% of users review order summary before completing checkout
- [ ] Users complete checkout in under 3 minutes from cart to confirmation

### Performance Targets
- [ ] Order summary loads in under 1 second
- [ ] System supports 5,000 concurrent checkouts

### Quality Metrics
- [ ] Checkout abandonment rate decreases by 15%
- [ ] Order correction requests decrease by 30%
```

## Optional Sections

Include these sections when they add value, not by default.

### Success Criteria

**When to Include**:
- Performance requirements beyond normal expectations
- Security or compliance needs
- Accessibility requirements
- Scalability targets

**Example**:
```markdown
## Success Criteria

### Performance
- Response times under heavy load
- Concurrent user targets

### Security
- Data encryption requirements
- Authentication/authorization needs

### Accessibility
- WCAG compliance level
- Screen reader support
```

### Edge Cases

**When to Include**:
- Known error conditions that need special handling
- Unusual but possible scenarios
- Boundary conditions

**Example**:
```markdown
## Edge Cases

- User has 100+ items in cart
- User's session expires during checkout
- Payment gateway is temporarily unavailable
- Item goes out of stock during checkout
```

### Dependencies

**When to Include**:
- External systems or services required
- Other features that must be completed first
- Third-party integrations

**Example**:
```markdown
## Dependencies

- Payment gateway integration (external)
- Inventory system API (internal)
- User authentication feature (prerequisite)
```

### Assumptions

**When to Include**:
- Decisions made without full information
- Simplifications for initial implementation
- Constraints accepted for this version

**Example**:
```markdown
## Assumptions

- Users have JavaScript enabled
- Payment gateway supports all major credit cards
- Tax rates available via API in all supported regions
- Initial launch supports US customers only
```

## Section Guidelines

### When to Include Optional Sections

**Include Success Criteria when**:
- Performance is critical to user experience
- Security/compliance is required
- Scalability beyond normal is needed

**Include Edge Cases when**:
- Known error scenarios need specific handling
- Boundary conditions affect design
- Risk mitigation is important

**Include Dependencies when**:
- External systems affect timeline
- Prerequisites must be tracked
- Integration complexity is high

**Include Assumptions when**:
- Decisions made with incomplete information
- Scope deliberately limited
- Future expansion planned

### When to Exclude Optional Sections

**Skip sections that**:
- Contain implementation details
- Duplicate other documentation
- Add no actionable information
- Are empty or speculative

**Examples to Skip**:
- Success Criteria: "Should be fast" (too vague)
- Edge Cases: "Might have issues with large files" (not specific)
- Dependencies: "Uses a database" (obvious)
- Assumptions: "Users want good UX" (too generic)

## Quality Guidelines

### Good Section Content
- Specific and actionable
- User-focused language
- Measurable where possible
- Technology-agnostic

### Poor Section Content
- Implementation details
- Vague requirements
- Obvious statements
- Technology choices
