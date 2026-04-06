# Success Criteria Patterns

## What Makes Good Success Criteria

### Measurable
Success criteria must be objectively verifiable with specific metrics or observable outcomes.

**Why**: Ambiguous criteria lead to disputes about whether a feature is complete. Measurable criteria enable clear validation.

**Examples**:
- Specific numbers: "95% of searches return results in under 1 second"
- Observable behaviors: "Users can export reports in PDF, CSV, and Excel formats"
- Quantifiable outcomes: "Shopping cart abandonment rate decreases by 20%"

### Technology-Agnostic
Focus on user-visible outcomes, not internal implementation details.

**Why**: Technology choices may change during implementation. Specifications should remain valid regardless of technical approach.

**Good**: "System supports 10,000 concurrent users"
**Bad**: "Redis cache handles 10,000 connections"

### User-Focused
Written from the perspective of what users experience, not what the system does internally.

**Why**: Specifications exist to capture user value. Internal metrics don't directly demonstrate user value.

**Good**: "Users complete checkout in under 3 minutes"
**Bad**: "API response time under 200ms"

### Verifiable
Can be tested through observation, measurement, or automated tests.

**Why**: If you can't verify a criterion, you can't confirm the feature is complete.

**Examples**:
- "All form inputs validate before submission" (testable)
- "Error messages guide users to fix issues" (observable)
- "System maintains 99.9% uptime" (measurable)

## Good Examples with Explanations

### E-commerce Checkout
**Criterion**: "Users complete checkout in under 3 minutes from cart to confirmation"

**Why it's good**:
- Measurable: Can time the flow
- User-focused: Describes user experience
- Technology-agnostic: No mention of implementation
- Verifiable: Can test with real users or automated flows

### Search Functionality
**Criterion**: "95% of searches return relevant results in the first 10 items"

**Why it's good**:
- Measurable: Specific percentage and position
- User-focused: About result quality, not search algorithm
- Technology-agnostic: Works with any search implementation
- Verifiable: Can test with sample queries and measure relevance

### Report Export
**Criterion**: "Users can export reports in PDF, CSV, and Excel formats with all data visible in the UI"

**Why it's good**:
- Measurable: Specific format list
- User-focused: About what users can do
- Technology-agnostic: No library or tool mentioned
- Verifiable: Can test each format

## Bad Examples (Implementation-Focused)

### API Performance
**Bad Criterion**: "API response time under 200ms for all endpoints"

**Why it's wrong**:
- Implementation detail: Exposes internal API design
- Not user-visible: Users don't directly see API response times
- Overly prescriptive: Locks in technical constraint

**Convert to Good**:
- "Search results appear within 1 second of user query"
- "Page transitions feel instant (no visible loading delay)"
- "Users can browse 100 products without pagination lag"

### Cache Metrics
**Bad Criterion**: "Redis cache hit rate above 80%"

**Why it's wrong**:
- Technology-specific: Mentions Redis explicitly
- Internal metric: Cache hit rate isn't user-visible
- Implementation detail: Assumes caching strategy

**Convert to Good**:
- "Frequently accessed data loads instantly on repeat visits"
- "Dashboard loads in under 2 seconds even with 1000 items"
- "Users see updated data within 5 seconds of changes"

### Framework Details
**Bad Criterion**: "React components render efficiently without unnecessary re-renders"

**Why it's wrong**:
- Technology-specific: Mentions React
- Implementation detail: Component optimization is internal
- Non-measurable: What's "efficiently"?

**Convert to Good**:
- "UI updates appear smooth with no visible lag when filtering 1000 items"
- "Form interactions feel responsive (under 100ms perceived delay)"
- "Page remains interactive while background data loads"

## Conversion Process

### Step 1: Identify the User Impact
Ask: "What user problem does this solve?" or "What user experience does this enable?"

**Example**:
- Bad: "Database queries optimized with indexes"
- Ask: What does this let users do?
- Good: "Search results appear in under 1 second for 99% of queries"

### Step 2: Remove Technology References
Replace technology-specific terms with outcome descriptions.

**Example**:
- Bad: "GraphQL API supports batched queries"
- Remove: GraphQL, batched queries
- Good: "Users can load related data without multiple page refreshes"

### Step 3: Add Measurable Metrics
Replace vague terms with specific numbers or observable behaviors.

**Example**:
- Bad: "System is fast"
- Add metrics: "System loads pages in under 2 seconds"
- Add observable: "Users see progress indicators during long operations"

### Step 4: Verify User Visibility
Ask: "Can a user directly see or measure this outcome?"

**Example**:
- Bad: "Microservices communicate asynchronously" (not visible)
- Good: "Users receive email confirmation within 1 minute of order" (visible)
