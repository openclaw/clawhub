---
parent_skill: pensive:api-review
name: exemplar-research
description: Research high-quality API exemplars for pattern guidance
category: api-analysis
tags: [api, exemplars, best-practices, patterns]
---

# Exemplar Research

Identify and analyze high-quality API references to establish pattern baselines.

## Language-Specific Exemplars

### Python
**pandas DataFrame API**
- Namespace: `pd.DataFrame.*`
- Patterns: Method chaining, symmetric I/O (`read_*`/`to_*`)
- Documentation: Multi-level (quickstart, API reference, examples)
- URL: https://pandas.pydata.org/docs/reference/frame.html

**requests Session API**
- Namespace: `requests.Session`
- Patterns: Context managers, connection pooling
- Error handling: Structured exceptions hierarchy
- URL: https://requests.readthedocs.io/en/latest/api/

### Rust
**tokio Runtime API**
- Namespace: `tokio::runtime`
- Patterns: Builder pattern, async traits
- Documentation: Module-level docs, examples
- URL: https://docs.rs/tokio/latest/tokio/runtime/

**serde Serialization**
- Namespace: `serde::Serialize`
- Patterns: Derive macros, trait composition
- Stability: Feature gates for optional formats
- URL: https://docs.rs/serde/latest/serde/

### Go
**net/http Package**
- Namespace: `net/http`
- Patterns: Interface composition, handler chains
- Error handling: Explicit error returns
- URL: https://pkg.go.dev/net/http

**database/sql**
- Namespace: `database/sql`
- Patterns: Connection pooling, prepared statements
- Resource management: Explicit Close()
- URL: https://pkg.go.dev/database/sql

### TypeScript
**Express.js Router**
- Namespace: `express.Router`
- Patterns: Middleware composition, fluent API
- Type safety: DefinitelyTyped integration
- URL: https://expressjs.com/en/4x/api.html

### REST APIs
**Stripe API**
- Patterns: Nested resources, pagination, idempotency
- Versioning: Date-based with headers
- Documentation: Interactive examples
- URL: https://stripe.com/docs/api

**GitHub REST API**
- Patterns: HATEOAS links, rate limiting
- Pagination: Link headers, cursor-based
- Errors: Structured error responses
- URL: https://docs.github.com/en/rest

## Pattern Capture

### For Each Exemplar
Record:
1. **Relevance**: Why this exemplar applies
2. **Key patterns**: 2-3 standout design decisions
3. **Documentation approach**: Structure and tooling
4. **Versioning strategy**: How stability is managed

### Common Patterns to Extract

#### Namespacing
- Flat vs hierarchical
- Module organization
- Import conventions

#### Pagination
- Cursor-based
- Offset-based
- Link headers
- Total count metadata

#### Error Handling
- Exception hierarchies
- Error codes/types
- Error response structure
- Retry guidance

#### Authentication
- API keys
- OAuth flows
- Token refresh
- Scope management

## Citation Format

Store references:
```markdown
## Exemplar: [Name]
**Language**: [Rust/Python/etc]
**URL**: [link]
**Relevance**: [why applicable]

### Key Patterns
1. [Pattern 1]: [description]
2. [Pattern 2]: [description]

### Applied to This Project
- [Comparison with current API]
- [Recommendations for alignment]
```

## Research Workflow

1. Identify language/API type
2. Find 2-3 exemplars per category
3. Document patterns with citations
4. Compare with current project API
5. Note alignment and gaps
