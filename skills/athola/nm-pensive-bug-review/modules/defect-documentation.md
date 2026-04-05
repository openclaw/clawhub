---
parent_skill: pensive:bug-review
category: analysis
estimated_tokens: 400
progressive_loading: true
dependencies: [imbue:proof-of-work]
---

# Defect Documentation

Systematic defect identification with precise file references and severity classification.

## File/Line References

Every defect must include:
- **File path**: Absolute or relative from project root
- **Line number**: Exact location of issue
- **Function/method**: Containing scope
- **Code snippet**: 3-5 lines of context

Example:
```
src/parser/tokenizer.rs:142 in `parse_string()`
```

## Severity Classification

| Level | Description | Impact | Response Time |
|-------|-------------|--------|---------------|
| **Critical** | Crash, data loss, security vulnerability | Service down, data corruption | Immediate |
| **High** | Major functionality broken | Core features unusable | This sprint |
| **Medium** | Degraded experience, workaround exists | Reduced performance/UX | Next sprint |
| **Low** | Minor issues, edge cases | Rare scenarios affected | Backlog |

## Root Cause Categories

### Logic Errors
- Incorrect conditions (off-by-one, wrong operator)
- Null/None handling gaps
- Missing validation
- Boundary condition failures

### API Misuse
- Wrong parameter types/order
- Deprecated method usage
- Incorrect error handling
- Lifetime/ownership violations (Rust)

### Concurrency Issues
- Race conditions
- Deadlocks
- Data races
- Improper synchronization
- Channel misuse (Go)

### Resource Leaks
- Memory leaks
- File handle leaks
- Connection pool exhaustion
- Lock not released

### Validation Gaps
- Missing input validation
- Insufficient boundary checks
- Type coercion errors
- Injection vulnerabilities

## Static Analyzer Commands

Run language-specific linters:

**Rust**
```bash
cargo clippy --all-targets --all-features
```

**Python**
```bash
ruff check .
mypy src/
```

**Go**
```bash
golangci-lint run
staticcheck ./...
```

**JavaScript/TypeScript**
```bash
eslint .
tsc --noEmit
```

**Java**
```bash
./gradlew check
spotbugs
```

## Documentation Format

```markdown
### [D1] file.rs:142 - Null pointer dereference

- **Severity**: Critical
- **Root Cause**: Logic error - missing null check
- **Impact**: Crash on malformed input
- **Evidence**: Line 142 dereferences `config.value` without validation
- **Context**:
  ```rust
  let value = config.value.unwrap(); // PANIC if None
  ```
```

## Cross-References

When relevant, link to:
- CVE databases for security issues
- Language RFCs or proposals
- Standard library documentation
- Known issue trackers
