# Code Review Masters

Expert frameworks for conducting effective code reviews, providing constructive feedback, and improving code quality through review processes.

## Masters Overview

| Expert | Key Contribution | Best For |
|--------|-----------------|----------|
| Google Engineering | Google's Code Review Guidelines | Scalable team practices |
| Martin Fowler | Refactoring Catalog | Identifying improvement patterns |
| Michael Feathers | Working with Legacy Code | Safe modification strategies |
| Karl Wiegers | Peer Reviews in Software | Process optimization |
| Trisha Gee | Code Review Best Practices | Practical JetBrains wisdom |

## Detailed Frameworks

### Google's Code Review Standards

**Source**: Google Engineering Practices Documentation (public)

**Core Idea**: Reviews should improve code health while enabling progress.

**Key Principles**:
- **Speed matters**: Review within 24 hours, ideally same day
- **Small changes**: Prefer small, focused CLs (changelists)
- **Approve if better**: Don't block for perfection
- **Distinguish severity**: Nit vs. suggestion vs. blocker

**The Standard**:
> "Reviewers should approve a CL once it definitely improves overall code health, even if it isn't perfect."

**Comment Prefixes**:
```
Nit:      Minor style preference, optional
Suggest:  Improvement idea, author decides
Consider: Worth thinking about, not blocking
BLOCKING: Must fix before approval
```

**Use When**: Establishing team review standards, training reviewers.

**Avoid When**: Security-critical code (needs stricter process).

---

### Fowler's Refactoring Patterns

**Source**: Martin Fowler - "Refactoring" (1999, 2nd ed. 2018)

**Core Idea**: Catalog of named transformations for improving code structure.

**Review Application**: Use pattern names as shared vocabulary in reviews.

**High-Value Patterns for Reviews**:
| Smell | Refactoring | Review Comment |
|-------|-------------|----------------|
| Long function | Extract Method | "This could be extracted into `calculateTotal()`" |
| Repeated code | Extract Method/Class | "Duplicated in lines 45, 89—extract?" |
| Long parameter list | Introduce Parameter Object | "Consider grouping these into a config object" |
| Feature Envy | Move Method | "This method uses more of Order than Cart" |
| Primitive Obsession | Replace with Value Object | "A Money type would prevent currency bugs" |

**Use When**: Providing actionable refactoring suggestions.

---

### Feathers' Legacy Code Strategies

**Source**: Michael Feathers - "Working Effectively with Legacy Code" (2004)

**Core Idea**: "Legacy code is code without tests." Review for testability.

**Key Review Questions**:
1. **Seams**: Are there places to substitute behavior for testing?
2. **Dependencies**: Can this be tested in isolation?
3. **Characterization**: Would a test capture current behavior?

**The Legacy Change Algorithm**:
1. Identify change points
2. Find test points
3. Break dependencies
4. Write tests
5. Make changes

**Review Comments for Legacy**:
```
"Before modifying this, consider adding a characterization test"
"This method has too many dependencies—can we inject the database?"
"Consider introducing a seam here for testability"
```

**Use When**: Reviewing changes to untested code.

---

### Wiegers' Peer Review Types

**Source**: Karl Wiegers - "Peer Reviews in Software" (2002)

**Core Idea**: Match review intensity to risk level.

**Review Spectrum**:
| Type | Effort | When to Use |
|------|--------|-------------|
| **Ad-hoc** | Lowest | Quick questions, pair checks |
| **Passaround** | Low | Routine changes, docs |
| **Walkthrough** | Medium | Knowledge sharing, onboarding |
| **Team Review** | Medium-High | Design decisions, complex logic |
| **Inspection** | Highest | Safety-critical, core algorithms |

**Defect Detection Rates**:
- Inspection: 60-90% of defects found
- Walkthrough: 20-40%
- Testing alone: 25-35%

**Use When**: Deciding review depth for different code types.

---

### Gee's Practical Code Review

**Source**: Trisha Gee - Various talks and articles (JetBrains)

**Core Idea**: Reviews should be humane and focused on learning.

**Key Principles**:
- **Automate the boring stuff**: Linting, formatting, style → CI
- **Focus human attention**: Logic, design, readability
- **Be kind**: Criticize code, not people
- **Ask questions**: "What was the thinking here?" vs "This is wrong"

**Comment Formulas**:
```
Instead of: "This is wrong"
Try:        "I'm curious—what led to this approach?"

Instead of: "Use X pattern"
Try:        "Have you considered X? It might help with Y"

Instead of: "This will break"
Try:        "What happens if input is null here?"
```

**Feedback Categories**:
1. **Bugs**: Logic errors, edge cases
2. **Design**: Coupling, cohesion, patterns
3. **Readability**: Naming, structure, comments
4. **Learning**: Knowledge sharing opportunities

**Use When**: Writing constructive review feedback, training reviewers.

## Selection Matrix

| Your Context | Primary Framework | Supporting |
|--------------|------------------|------------|
| High-velocity team | Google Standards | Gee |
| Improving existing code | Fowler | Feathers |
| Safety-critical systems | Wiegers | Feathers |
| Team culture improvement | Gee | Google |
| Legacy codebase | Feathers | Fowler |

## Review Checklist Template

Based on blended frameworks:

```markdown
## Quick Checks (Automate These)
- [ ] Passes linting
- [ ] Passes tests
- [ ] No merge conflicts

## Human Review Focus
### Correctness
- [ ] Logic handles edge cases
- [ ] Error handling appropriate

### Design (Fowler)
- [ ] No obvious code smells
- [ ] Single responsibility followed
- [ ] Dependencies reasonable

### Testability (Feathers)
- [ ] New code has tests
- [ ] Changes don't break test isolation
- [ ] Can test in isolation

### Readability (Gee)
- [ ] Names reveal intent
- [ ] Comments explain "why" not "what"
- [ ] Complexity appropriate
```

## Anti-Patterns to Avoid

- **Nitpick storms**: Dozens of style comments (use linters)
- **Rubber stamping**: Approving without reading
- **Gatekeeping**: Using reviews to block or control
- **Scope creep**: Requesting unrelated changes
- **Delayed reviews**: Blocking progress for days
