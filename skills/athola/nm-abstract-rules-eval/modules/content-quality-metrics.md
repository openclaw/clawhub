# Content Quality Metrics

## Quality Criteria

### Actionability
Rules should provide clear, actionable guidance. Descriptions alone are insufficient.

```markdown
<!-- BAD: Just a description -->
This project uses TypeScript.

<!-- GOOD: Actionable guidance -->
Use strict TypeScript. Enable `noImplicitAny` and `strictNullChecks`.
Prefer interfaces over type aliases for object shapes.
```

### Conciseness
Each rule file should be focused and concise (< 500 tokens typical).

### Non-Conflicting
Rules across files should not contradict each other.

### Single Topic
Each rule file should address one focused topic.

## Scoring (25 points, deductive)

Starts at 25, deducts for issues found:

| Issue | Deduction | Criteria |
|-------|-----------|----------|
| Empty content | -25 | Rule file has no body text |
| Too short | -5 | Fewer than 10 words |
| Too verbose | -5 | Exceeds 500 estimated tokens |
