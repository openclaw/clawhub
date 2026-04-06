---
parent_skill: pensive:bug-review
category: remediation
estimated_tokens: 450
progressive_loading: true
---

# Fix Preparation

Create minimal, idiomatic patches with detailed test coverage.

## Minimal Patch Patterns

Apply smallest change that fixes the issue:

**Guard Clause** (prevent invalid state)
```rust
// Before: crash on None
let value = config.value.unwrap();

// After: guard clause
let Some(value) = config.value else {
    return Err(Error::MissingConfig);
};
```

**Validation** (check inputs)
```python
# Before: no validation
def process(count: int):
    return items[:count]

# After: boundary check
def process(count: int):
    if count < 0 or count > len(items):
        raise ValueError(f"Invalid count: {count}")
    return items[:count]
```

**Resource Cleanup** (prevent leaks)
```go
// Before: file handle leak
file, err := os.Open(path)
data, _ := io.ReadAll(file)

// After: defer cleanup
file, err := os.Open(path)
if err != nil {
    return err
}
defer file.Close()
data, err := io.ReadAll(file)
```

## Idiomatic Fixes by Language

### Rust
- Use `?` operator for error propagation
- Prefer pattern matching over `unwrap()`
- Use `Option::ok_or()` for conversions
- Apply ownership transfer instead of cloning

```rust
// Idiomatic error handling
fn load_config() -> Result<Config, Error> {
    let path = env::var("CONFIG_PATH")
        .map_err(|_| Error::MissingEnv)?;
    let contents = fs::read_to_string(&path)?;
    toml::from_str(&contents)
        .map_err(Error::Parse)
}
```

### Python
- Use context managers for resources
- Apply type hints for clarity
- Use specific exception types
- Prefer `pathlib` over string paths

```python
# Idiomatic resource handling
from pathlib import Path
from contextlib import contextmanager

def load_config(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")
    with path.open() as f:
        return json.load(f)
```

### Go
- Check errors immediately
- Use `defer` for cleanup
- Apply early returns
- Wrap errors with context

```go
// Idiomatic error handling
func LoadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("reading config: %w", err)
    }

    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("parsing config: %w", err)
    }

    return &cfg, nil
}
```

### TypeScript
- Use strict null checks
- Apply discriminated unions
- Prefer async/await over promises
- Use type guards for narrowing

```typescript
// Idiomatic null handling
function processValue(value: string | null): Result {
    if (value === null) {
        throw new Error("Value required");
    }
    // TypeScript knows value is string here
    return { data: value.toLowerCase() };
}
```

## Test Coverage Requirements

Every fix must include tests following Red → Green pattern:

### 1. Red: Write Failing Test
```rust
#[test]
fn test_config_missing_value() {
    let config = Config { value: None };
    // This should fail before fix
    assert!(process_config(&config).is_err());
}
```

### 2. Green: Apply Fix
Implement the minimal change to pass the test.

### 3. Verify: Run Test Suite
```bash
cargo test
pytest -v
go test ./...
npm test
```

## Test Categories

**Unit Tests**: Test individual functions in isolation
```python
def test_boundary_validation():
    with pytest.raises(ValueError):
        process(count=-1)
```

**Integration Tests**: Test component interactions
```rust
#[test]
fn test_config_loading_integration() {
    let cfg = load_config("test.toml").unwrap();
    assert_eq!(cfg.value, Some(42));
}
```

**Regression Tests**: Prevent bug recurrence
```go
func TestNoPanicOnNilValue(t *testing.T) {
    // Regression test for issue #123
    result, err := Process(nil)
    require.Error(t, err)
    assert.Nil(t, result)
}
```

## Explanation Requirements

For each fix, document:
1. **What changed**: Specific code modifications
2. **Why it works**: Mechanism that prevents the bug
3. **Best practice**: Link to language idioms or patterns
4. **Trade-offs**: Performance, complexity, or maintainability impact
