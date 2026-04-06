---
parent_skill: pensive:test-review
name: coverage-analysis
description: Coverage measurement and gap identification
category: testing
tags: [coverage, testing, gap-analysis]
load_priority: 2
estimated_tokens: 350
---

# Coverage Analysis

Measure test coverage and identify gaps.

## Coverage Tools by Language

### Rust
```bash
# Using tarpaulin
cargo install cargo-tarpaulin
cargo tarpaulin --out Html --output-dir coverage/

# Using llvm-cov
cargo install cargo-llvm-cov
cargo llvm-cov --html
```

### Python
```bash
# Using pytest-cov
pytest --cov=src --cov-report=html --cov-report=term-missing

# Using coverage.py
coverage run -m pytest
coverage html
coverage report --show-missing
```

### JavaScript/TypeScript
```bash
# Jest
npm test -- --coverage --coverageReporters=html text

# Vitest
vitest --coverage

# Cypress (code coverage plugin)
cypress run --env coverage=true
```

### Go
```bash
# Built-in coverage
go test -cover ./...
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out

# Detailed coverage
go test -covermode=count -coverprofile=coverage.out ./...
```

## Coverage Thresholds

| Level | Coverage | Use Case |
|-------|----------|----------|
| Minimum | 60% | Legacy code, initial cleanup |
| Standard | 80% | Normal development |
| High | 90% | Critical systems, libraries |
| detailed | 95%+ | Safety-critical, financial |

## Gap Identification

### Find impacted test files
```bash
# Tests affected by changes
git diff --name-only main...HEAD | rg 'tests|spec|feature'

# Find related tests
git diff --name-only main...HEAD | while read file; do
  basename "$file" .py | xargs -I {} find . \
    -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
    -not -path "*/node_modules/*" -not -path "*/.git/*" \
    -name "*test*{}*"
done
```

### Identify uncovered code
1. Run coverage tool with `--show-missing` flag
2. Cross-reference with critical paths:
   - Authentication/authorization
   - Data validation
   - Error handling
   - API endpoints
   - Database operations

3. Map to requirements:
   - Feature specifications
   - User stories
   - Bug reports
   - Security requirements

### Coverage Patterns

**Critical paths** (should be 100%):
- Security boundaries (auth, validation)
- Data integrity operations
- Error recovery logic
- Public API surface

**Lower priority** (can be <80%):
- Internal helpers
- Logging/debugging code
- Trivial getters/setters
- Deprecated code paths

## Output Format

```markdown
## Coverage Analysis
- **Overall**: 78%
- **Critical paths**: 92%
- **Changed files**: 85%

### Gaps Identified
1. **src/auth.py:45-60** - Token validation edge cases
2. **src/api/routes.py:120-135** - Error handling for 400/500 codes
3. **src/db/migrations.py** - Rollback scenarios untested

### Test-to-Feature Mapping
- Feature: User registration → `tests/test_registration.py` (95%)
- Feature: Password reset → `tests/test_auth.py` (60%) [WARN]
- Feature: Email validation → Missing tests [FAIL]
```

## Best Practices

1. **Branch coverage** over line coverage when available
2. **Mutation testing** for critical code (e.g., `cargo mutants`, `mutmut`)
3. **Coverage trends**: Track over time, not just absolute values
4. **Exclude generated code**: Focus on hand-written logic
5. **Integration coverage**: Don't just unit test in isolation
