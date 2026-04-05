# Description Writing for Skill Discovery

## Overview

Skill descriptions are critical for Claude's skill selection process. They determine whether skills are discovered, activated, and used correctly. This module covers optimization techniques for writing descriptions that maximize discoverability.

## Why Descriptions Matter

### Discovery Process

When Claude encounters a task:
1. **Semantic Search**: Matches task description against skill descriptions
2. **Relevance Ranking**: Scores skills by description similarity
3. **Context Check**: Verifies "Use when" conditions match
4. **Activation**: Loads highest-scoring relevant skills

**Implication**: If your description doesn't match user language patterns, the skill won't be discovered.

### Common Failures

 **Too Vague**: "Helps with coding"
- Matches everything, provides no signal
- Can't distinguish from other skills

 **Too Specific**: "Implements OAuth2 PKCE flow with rotating refresh tokens"
- Only matches exact terminology
- Misses general queries like "add authentication"

 **Missing Context**: "Provides testing guidelines"
- Unclear when to use vs. other testing skills
- No activation triggers

## Description Formula

```
[WHAT it does] + [WHEN to use it] + [KEY TRIGGERS/TERMS]
```

### Components

1. **WHAT**: Clear action or capability (third person)
2. **WHEN**: Explicit "Use when..." clause
3. **TRIGGERS**: Domain-specific terms for discovery

### Example

```yaml
description: Guides secure API endpoint design with input validation, error handling, and authentication. Use when creating new endpoints, reviewing API security, or implementing REST services. Covers rate limiting, CORS, and security headers.
```

**Breakdown:**
- **WHAT**: "Guides secure API endpoint design with [specifics]"
- **WHEN**: "Use when creating new endpoints, reviewing API security, or implementing REST services"
- **TRIGGERS**: API, endpoint, validation, authentication, REST, rate limiting, CORS, security

## Voice and Tone

### Third Person Always

 **Correct:**
- "Teaches..."
- "Provides..."
- "Guides..."
- "Implements..."
- "Analyzes..."

 **Incorrect:**
- "I teach..."
- "We provide..."
- "Helps you..."
- "Will guide..."

### Active, Specific Verbs

 **Strong Verbs:**
- Guides, teaches, implements, validates, enforces
- Analyzes, optimizes, automates, generates
- validates, prevents, detects, corrects

 **Weak Verbs:**
- Helps with, deals with, handles
- Supports, provides support for
- Assists in, aids in

### Example Transformation

 **Weak:**
```yaml
description: Helps you write better tests for your code.
```

 **Strong:**
```yaml
description: Guides test-driven development using RED-GREEN-REFACTOR methodology. Use when writing new tests, refactoring code, or establishing testing discipline. Covers unit tests, integration tests, and test coverage strategies.
```

## The "Use When" Clause

### Purpose

Explicitly states activation conditions, helping both:
1. **Claude**: Understand when to activate skill
2. **Users**: Understand what skill is for

### Structure

```
Use when [primary use case], [secondary use case], or [tertiary use case].
```

### Examples

 **Specific Conditions:**
```
Use when creating new API endpoints, reviewing security implementations, or debugging authentication issues.
```

 **Task Types:**
```
Use when refactoring large files, optimizing code structure, or improving maintainability.
```

 **Problem Scenarios:**
```
Use when tests are missing, coverage is low, or regression bugs appear frequently.
```

 **Too Vague:**
```
Use when working with APIs.
```

 **Too Narrow:**
```
Use when implementing OAuth2 PKCE flow specifically for mobile applications.
```

## Key Terms for Discovery

### Analysis of 100+ Skills

Common high-value discovery terms across successful skills:

**Development Workflow:**
- testing, TDD, refactoring, code review
- debugging, optimization, performance
- architecture, design patterns, structure

**Language/Framework:**
- Python, JavaScript, Rust, Go
- React, Django, Flask, Express
- async, typing, generics

**Security:**
- authentication, authorization, validation
- security, encryption, sanitization
- rate limiting, CORS, headers

**Data:**
- API, REST, GraphQL, database
- SQL, NoSQL, migrations
- serialization, validation

**Quality:**
- tests, coverage, quality, metrics
- documentation, standards, best practices
- compliance, validation, checking

### Incorporating Discovery Terms

**Technique**: Include specific terms users might search for

```yaml
# Too generic
description: Helps with Python code quality.

# Optimized for discovery
description: Analyzes Python code quality using type hints, async patterns, and testing best practices. Use when reviewing code, improving type safety, or optimizing async/await usage. Covers mypy, pytest, and performance profiling.
```

**Discovery terms added:**
- Python (language)
- type hints, typing (specific feature)
- async, await (pattern)
- mypy, pytest (tools)
- performance, profiling (category)

## Length Considerations

### Character Limits

**Recommended**: 200-400 characters
**Maximum**: 1024 characters (hard limit)
**Minimum**: 100 characters (for adequate context)

### Optimization Strategy

**Under 200 chars**: Too brief, missing context
→ Add specific use cases or key features

**200-400 chars**: Ideal range
→ Balance specificity with readability

**Over 600 chars**: Too verbose
→ Move details to SKILL.md body, keep description focused

### Example Progression

**Too Short (85 chars):**
```yaml
description: Guides API security. Use when building APIs.
```

**Optimal (285 chars):**
```yaml
description: Guides secure API endpoint design with input validation, error handling, and authentication best practices. Use when creating new endpoints, reviewing API security, or implementing REST/GraphQL services. Covers rate limiting, CORS, security headers, and common vulnerabilities.
```

**Too Long (520 chars):**
```yaml
description: detailed guide to secure API endpoint design covering all aspects of security including input validation with regex and type checking, detailed error handling with proper HTTP status codes and error messages, authentication mechanisms including JWT and OAuth2, authorization with RBAC and ABAC, rate limiting strategies, CORS configuration, security headers like CSP and HSTS, and protection against common vulnerabilities including SQL injection, XSS, CSRF, and more.
```

## Pattern Library

### Technique Skills

**Pattern:**
```
Teaches [specific methodology] for [domain]. Use when [scenarios]. Covers [key aspects].
```

**Example:**
```yaml
description: Teaches test-driven development using RED-GREEN-REFACTOR cycle for Python. Use when writing new tests, refactoring code, or improving test coverage. Covers pytest, unittest, and mock strategies.
```

### Tool/Framework Skills

**Pattern:**
```
Guides [tool/framework] [specific use] with [approaches]. Use when [scenarios]. Covers [features].
```

**Example:**
```yaml
description: Guides FastAPI development with async patterns, dependency injection, and OpenAPI documentation. Use when building REST APIs, implementing async endpoints, or generating API docs. Covers Pydantic models, authentication, and testing.
```

### Review/Audit Skills

**Pattern:**
```
Analyzes [target] for [qualities]. Use when [review scenarios]. Checks [specific items].
```

**Example:**
```yaml
description: Analyzes API security for authentication, validation, and error handling compliance. Use when reviewing endpoints, auditing security practices, or preparing for deployment. Checks OAuth flows, input sanitization, and rate limiting.
```

### Pattern/Practice Skills

**Pattern:**
```
Implements [pattern/practice] for [outcome]. Use when [scenarios]. Follows [standards].
```

**Example:**
```yaml
description: Implements repository pattern for data access layer separation. Use when designing database interactions, refactoring data access code, or implementing clean architecture. Follows DDD principles and SOLID design.
```

## Common Mistakes

### 1. First Person Voice

 **Wrong:**
```yaml
description: I help you write better commit messages using conventional commits.
```

 **Correct:**
```yaml
description: Guides commit message writing using conventional commits standard. Use when committing changes, reviewing git history, or establishing commit conventions.
```

### 2. Marketing Language

 **Wrong:**
```yaml
description: The ultimate, detailed, enterprise-grade solution for all your testing needs! Revolutionary approach that will transform your development workflow!
```

 **Correct:**
```yaml
description: Guides test-driven development using RED-GREEN-REFACTOR methodology. Use when writing tests, refactoring code, or improving coverage. Covers unit, integration, and end-to-end testing.
```

### 3. Missing "Use When"

 **Wrong:**
```yaml
description: Provides API security guidelines and best practices for authentication and validation.
```

 **Correct:**
```yaml
description: Provides API security guidelines for authentication and input validation. Use when designing endpoints, reviewing security, or implementing access controls. Covers OAuth, JWT, and rate limiting.
```

### 4. Too Technical

 **Wrong:**
```yaml
description: Implements CQRS/ES architectural pattern with event sourcing, domain events, aggregate roots, and eventual consistency patterns for distributed systems using message brokers.
```

 **Better:**
```yaml
description: Guides CQRS and event sourcing architecture for scalable systems. Use when designing command/query separation, implementing event-driven patterns, or building distributed applications. Covers aggregates, events, and consistency.
```

### 5. No Discovery Terms

 **Wrong:**
```yaml
description: Helps with code organization and structure improvements.
```

 **Better:**
```yaml
description: Guides code refactoring for improved structure and maintainability. Use when cleaning up legacy code, applying SOLID principles, or reducing technical debt. Covers extract method, dependency injection, and module organization.
```

## A/B Testing Descriptions

### Methodology

1. Create two versions of description
2. Test discovery with 10+ varied queries
3. Count how many queries successfully activate skill
4. Choose version with higher activation rate

### Example Test

**Version A:**
```yaml
description: Helps with Python testing.
```

**Version B:**
```yaml
description: Guides Python testing using pytest and unittest frameworks. Use when writing tests, debugging test failures, or improving coverage. Covers fixtures, mocks, and parametrization.
```

**Test Queries:**
1. "Add tests for this Python function"
2. "How do I test async Python code"
3. "Set up pytest for my project"
4. "Mock external API in tests"
5. "Improve test coverage"

**Results:**
- Version A: 2/5 activations (40%)
- Version B: 5/5 activations (100%)

## Validation Checklist

Before finalizing a description:

- [ ] Uses third person voice
- [ ] Includes "Use when..." clause
- [ ] Has 3+ specific use cases
- [ ] Contains relevant discovery terms
- [ ] Length is 200-400 characters
- [ ] Avoids marketing language
- [ ] Specifies what skill does (not just domain)
- [ ] Distinguishes from similar skills
- [ ] Uses active, specific verbs
- [ ] Would match user's natural language

## Tools

### Character Counter

```bash
# Count description length
echo "Your description here" | wc -c
```

### Discovery Term Extraction

```python
def extract_discovery_terms(description: str) -> list[str]:
    """Extract potential discovery keywords from description."""
    # Common stop words to exclude
    stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for'}

    # Split and filter
    words = description.lower().split()
    terms = [w.strip('.,!?;:') for w in words
             if w not in stop_words and len(w) > 3]

    return sorted(set(terms))
```

### A/B Test Template

```markdown
## Description A/B Test

### Version A
```yaml
description: [First version]
```

### Version B
```yaml
description: [Second version]
```

### Test Queries
1. [Common user query 1]
2. [Common user query 2]
...

### Results
| Query | Version A | Version B |
|-------|-----------|-----------|
| Q1    | OK/FAIL       | OK/FAIL       |
| Q2    | OK/FAIL       | OK/FAIL       |

**Winner**: Version [A/B] ([X]% activation rate)
```

## Summary

Effective descriptions:
1. **Third person voice**: "Guides...", "Teaches...", "Implements..."
2. **Include "Use when"**: Explicit activation conditions
3. **Key discovery terms**: Match user language patterns
4. **200-400 characters**: Specific but concise
5. **Active verbs**: Clear action orientation
6. **Specific use cases**: Concrete scenarios, not vague domains

Formula: `[WHAT] + [WHEN] + [KEY TERMS]`

Test with real queries to validate discoverability.
