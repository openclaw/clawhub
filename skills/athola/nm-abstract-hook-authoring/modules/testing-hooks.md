# Testing Hooks

Testing strategies for hook development. Covers unit testing hook logic, mocking external dependencies, and CI/CD integration.

## Testing Philosophy

### Core Testing Principles

1. **Test Hook Logic, Not Tools**: Test your hook's behavior, not Claude's tools
2. **Mock External Dependencies**: Isolate hook logic from I/O and network
3. **Test All Paths**: Happy path, error cases, edge cases
4. **Verify Performance**: Test timing budgets and resource usage
5. **Security Testing**: Test security controls and sanitization

## Test Categories

| Category | Purpose | Budget |
|----------|---------|--------|
| Unit | Hook method logic | < 100ms |
| Integration | Hook chains, mock agent | < 500ms |
| Security | Secret sanitization, injection prevention | < 200ms |
| Performance | Timing budgets, memory bounds | Varies |

## Quick Reference

### Unit Test Pattern

```python
@pytest.mark.asyncio
async def test_hook_behavior():
    hooks = MyHooks()
    result = await hooks.on_pre_tool_use("Bash", {"command": "ls"})
    assert result is None  # or expected modification
```

### Return Value Testing

| Hook | Return None | Return Modified |
|------|-------------|-----------------|
| PreToolUse | Allow unchanged | Modified input dict |
| PostToolUse | Allow unchanged | Modified output string |
| Stop | Block with error | N/A |

### Error Handling Pattern

```python
@pytest.mark.asyncio
async def test_graceful_failure():
    hooks = ResilientHooks()
    # Even with invalid input, should return None (allow)
    result = await hooks.on_pre_tool_use("Bash", {"invalid": "input"})
    assert result is None
```

## Security Test Checklist

- [ ] API keys redacted from logs
- [ ] Passwords sanitized in output
- [ ] Path traversal blocked
- [ ] Command injection prevented
- [ ] Allowed operations permitted

## Performance Targets

| Operation | P50 | P95 | Max |
|-----------|-----|-----|-----|
| PreToolUse validation | < 50ms | < 100ms | < 200ms |
| PostToolUse logging | < 100ms | < 500ms | < 1s |
| Memory per 10K ops | < 10MB | < 20MB | < 50MB |

## Test Fixtures

### Essential Fixtures

```python
@pytest.fixture
def temp_log_file():
    with tempfile.NamedTemporaryFile(suffix='.log') as f:
        yield Path(f.name)

@pytest.fixture
def mock_file_system():
    mock_fs = MagicMock()
    mock_fs.exists.return_value = True
    return mock_fs
```

## Testing Checklist

Before deploying hooks, verify:

- [ ] **Unit Tests**: All hook methods tested
- [ ] **Happy Path**: Normal operations work
- [ ] **Error Cases**: Errors handled gracefully
- [ ] **Edge Cases**: Boundary conditions tested
- [ ] **Security**: Secret sanitization verified
- [ ] **Performance**: Timing budgets met
- [ ] **Memory**: No memory leaks
- [ ] **Integration**: Works with mock agent
- [ ] **Coverage**: > 90% line coverage

## Detailed Examples

For comprehensive test examples including:
- Full unit test suites
- Integration test patterns
- Security test cases
- Performance benchmarks
- CI/CD configuration

See `Skill(abstract:hook-authoring)` for full hook development patterns including test examples.

## Related Modules

- **hook-types.md**: Event types to test
- **sdk-callbacks.md**: Implementation patterns to test
- **performance-guidelines.md**: Performance targets to verify
