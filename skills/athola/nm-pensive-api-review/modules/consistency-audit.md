---
parent_skill: pensive:api-review
name: consistency-audit
description: Audit API consistency against patterns and exemplars
category: api-analysis
tags: [api, consistency, audit, patterns]
---

# Consistency Audit

Compare API surfaces against exemplar patterns and internal consistency rules.

## Naming Consistency

### Check Patterns
- **Verb/noun ordering**: `get_user` vs `user_get`
- **Pluralization**: `get_items` vs `get_item_list`
- **Abbreviations**: `cfg` vs `config`, `ctx` vs `context`
- **Case conventions**: snake_case, camelCase, PascalCase

### Commands
```bash
# Function name patterns
rg -n "^(pub )?fn " src | cut -d: -f2 | sort | uniq -c

# Type name patterns
rg -n "^(pub )?struct|enum|type" src

# HTTP endpoint patterns
rg -n "path.*=.*\"" src | grep -o '"[^"]*"' | sort
```

### Red Flags
- Mixed naming conventions in same module
- Inconsistent verb prefixes (get vs fetch vs retrieve)
- Language idiom violations

## Parameter Conventions

### Check for Consistency
1. **Ordering**: receiver, required, optional, callbacks
2. **Optional handling**: Option types, defaults, overloads
3. **Builder patterns**: When to use vs direct construction
4. **Type annotations**: Complete and accurate

### Language-Specific

#### Rust
```rust
// Consistent ordering: receiver, required, optional
impl Client {
    pub fn new(config: Config) -> Self { }
    pub fn with_timeout(mut self, timeout: Duration) -> Self { }
}
```

#### Python
```python
# Consistent optional parameters
def read_data(path: str,
              format: str = "csv",
              encoding: str = "utf-8") -> DataFrame:
    pass
```

#### Go
```go
// Consistent context placement
func GetUser(ctx context.Context, id string) (*User, error)
```

### Audit Commands
```bash
# Parameter counts and patterns
rg -n "fn \w+\(" src | rg -o "\(.*\)" | sort | uniq -c

# Optional parameter patterns
rg -n "Option<|Optional<|\?:" src
```

## Return Type Patterns

### Consistency Checks
- **Error handling**: Result types, exceptions, error tuples
- **Null handling**: Option types, nullable annotations
- **Collection returns**: List, Array, Iterator
- **Pagination**: Page objects, cursor tokens

### By Language

#### Rust
```bash
# Result usage
rg -n "-> Result<" src

# Option usage
rg -n "-> Option<" src
```

#### Python
```bash
# Type hints
rg -n "-> (List|Dict|Optional|Union)" package

# Exception documentation
rg -n "Raises:" docs
```

#### Go
```bash
# Error returns (should be last)
rg -n "func .* \(.*error\)$" .

# Pointer returns
rg -n "func .* \*\w+," .
```

### Red Flags
- Mixed error handling strategies
- Inconsistent null/empty semantics
- Varying pagination approaches

## Error Semantics

### Check Consistency
1. **Error types**: Custom vs standard
2. **Error messages**: Format and detail level
3. **Error codes**: Numeric, string, or enum
4. **Retry guidance**: Transient vs permanent

### Audit Pattern
```bash
# Custom error types
rg -n "struct \w*Error|enum \w*Error" src

# Error creation patterns
rg -n "Error::new|errors\.New|raise \w+Error" src

# HTTP status codes
rg -n "StatusCode::|status_code|status =" src
```

### Expected Patterns
- Structured error hierarchy
- Consistent error construction
- Clear transient vs permanent distinction
- Actionable error messages

## Deprecation Handling

### Check for Proper Deprecation
1. **Attributes/decorators**: `#[deprecated]`, `@deprecated`
2. **Documentation**: Clear migration path
3. **Timeline**: Version removal planned
4. **Alternatives**: Replacement API documented

### Commands
```bash
# Deprecation markers
rg -n "#\[deprecated|@deprecated|DEPRECATED" src

# Migration notes
rg -n "migration|migrating|instead use" docs
```

### Expected Pattern
```rust
#[deprecated(since = "1.2.0", note = "Use `new_api` instead")]
pub fn old_api() { }
```

## Anti-Patterns

### Detect Common Issues

#### Duplication
```bash
# Similar function names
rg -n "^(pub )?fn " src | cut -d: -f2 | sort | uniq -d
```

#### Leaky Abstractions
- Internal types in public signatures
- Implementation details exposed
- Platform-specific APIs without gates

#### Missing Feature Gates
```bash
# Check conditional compilation
rg -n "#\[cfg\(|#\[cfg_attr\(" src
```

## Test Coverage Audit

### Verify API Testing
```bash
# Test files covering public API
find tests -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  \( -name "test_*.py" -o -name "*_test.go" -o -name "*.test.ts" \)

# Integration tests
rg -n "integration|e2e|contract" tests
```

### Expected Coverage
- Unit tests for each public function
- Integration tests for workflows
- Contract tests for external APIs
- Edge case coverage

## Output Format

```markdown
## Consistency Audit Results

### Naming Issues
- [I1] Mixed case conventions in module X
  - Location: file:line
  - Pattern: snake_case vs camelCase
  - Recommendation: Standardize on snake_case

### Parameter Issues
- [I2] Inconsistent optional parameter handling
  - Location: functions A, B, C
  - Pattern: Mixed Option<T> and default values
  - Recommendation: Use Option<T> consistently

### Return Type Issues
- [I3] Mixed error handling
  - Locations: file1.rs, file2.rs
  - Pattern: Some functions return Result, others panic
  - Recommendation: Consistent Result returns

### Deprecation Issues
- [I4] Missing migration path for deprecated API
  - Location: old_api()
  - Issue: No alternative documented
  - Recommendation: Document replacement
```
