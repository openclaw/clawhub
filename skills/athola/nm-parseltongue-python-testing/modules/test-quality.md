---
name: test-quality
description: Best practices, anti-patterns to avoid, and quality criteria for Python tests
category: testing
tags: [python, pytest, best-practices, quality, anti-patterns]
dependencies: [unit-testing, fixtures-and-mocking]
estimated_tokens: 250
---

# Test Quality

Guidelines for writing high-quality, maintainable tests.

## Table of Contents

- [Best Practices](#best-practices)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
  - [Testing Private Methods Directly](#testing-private-methods-directly)
  - [Over-mocking Simple Calculations](#over-mocking-simple-calculations)
  - [Shared Mutable State](#shared-mutable-state)
  - [Order-Dependent Tests](#order-dependent-tests)
  - [Assertions Without Clear Messages](#assertions-without-clear-messages)
- [Exit Criteria](#exit-criteria)

## Best Practices

1. **Test behavior, not implementation** - Focus on public interfaces
   ```python
   # Good: Test behavior
   def test_user_can_login():
       user = authenticate("user@example.com", "password")
       assert user.is_authenticated

   # Bad: Test implementation details
   def test_password_hash_algorithm():
       assert user._hash_password("pass").startswith("$2b$")
   ```

2. **One assertion per test** - Keep tests focused
   ```python
   # Good: Single concern
   def test_user_creation_sets_email():
       user = User.create(email="test@example.com")
       assert user.email == "test@example.com"

   def test_user_creation_generates_id():
       user = User.create(email="test@example.com")
       assert user.id is not None
   ```

3. **Independent tests** - No shared state between tests
   ```python
   # Good: Each test is independent
   @pytest.fixture
   def user():
       return User(name="Test")

   # Bad: Tests share state
   shared_user = User(name="Test")
   ```

4. **Descriptive names** - Make test intent clear
   ```python
   # Good: Clear intent
   def test_user_creation_with_invalid_email_raises_value_error():
       with pytest.raises(ValueError):
           User.create(email="invalid")

   # Bad: Unclear
   def test_user_error():
       ...
   ```

5. **Use fixtures** - Avoid setup duplication
6. **Mock at boundaries** - Only mock external dependencies
7. **Measure coverage** - Aim for meaningful, not just high

## Anti-Patterns to Avoid

### Testing Private Methods Directly

```python
# Bad: Testing private methods
def test_private_hash_function():
    assert User._hash_password("test") == "..."

# Good: Test through public interface
def test_password_verification():
    user = User.create(password="test")
    assert user.verify_password("test")
```

### Over-mocking Simple Calculations

```python
# Bad: Mocking simple logic
@patch("math.sqrt")
def test_calculation(mock_sqrt):
    mock_sqrt.return_value = 3
    assert calculate_distance(0, 0, 3, 4) == 5

# Good: Test actual calculation
def test_calculation():
    assert calculate_distance(0, 0, 3, 4) == 5
```

### Shared Mutable State

```python
# Bad: Shared mutable state
cache = {}

def test_cache_set():
    cache["key"] = "value"
    assert cache["key"] == "value"

def test_cache_empty():  # Fails if test_cache_set runs first
    assert len(cache) == 0
```

### Order-Dependent Tests

```python
# Bad: Tests depend on order
def test_step_1():
    global state
    state = "initialized"

def test_step_2():
    assert state == "initialized"  # Depends on test_step_1
```

### Assertions Without Clear Messages

```python
# Bad: Unclear failure
assert len(users) > 0

# Good: Clear failure message
assert len(users) > 0, f"Expected users but got empty list"
```

## Exit Criteria

Before considering tests complete:

- [ ] Tests follow AAA pattern
- [ ] Coverage meets project threshold (≥80%)
- [ ] All tests independent and reproducible
- [ ] CI/CD integration configured
- [ ] Clear test naming and organization
- [ ] No anti-patterns present
- [ ] Fixtures used appropriately
- [ ] Mocking only at boundaries
