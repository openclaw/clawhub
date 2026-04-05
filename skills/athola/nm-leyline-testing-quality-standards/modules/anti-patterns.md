---
name: anti-patterns
description: Testing anti-patterns to avoid with before/after code examples
parent_skill: leyline:testing-quality-standards
category: infrastructure
estimated_tokens: 600
reusable_by: [pensive:test-review, parseltongue:python-testing, sanctum skills]
---

# Testing Anti-Patterns

## Testing Implementation Details

```python
# Bad: Testing private methods
def test_internal_method():
    service = UserService()
    result = service._validate_email("test@example.com")  # Testing private method
    assert result is True

# Good: Testing public behavior
def test_user_creation_validates_email():
    service = UserService()
    with pytest.raises(ValidationError):
        service.create_user("Alice", "invalid-email")
```

## Over-Mocking

```python
# Bad: Mocking simple calculations
@patch("calculator.add")
def test_total(mock_add):
    mock_add.return_value = 5
    assert calculate_total(2, 3) == 5

# Good: Test the actual logic
def test_total():
    assert calculate_total(2, 3) == 5
```

## Missing Assertions

```python
# Bad: No assertions
def test_user_creation():
    user = create_user("Alice", "alice@example.com")
    print(f"Created user: {user}")  # No assertions

# Good: Clear assertions
def test_user_creation():
    user = create_user("Alice", "alice@example.com")
    assert user.name == "Alice"
    assert user.email == "alice@example.com"
    assert user.is_active is True
```

## Shared Mutable State

```python
# Bad: Shared mutable state between tests
shared_data = []

def test_append():
    shared_data.append(1)
    assert len(shared_data) == 1

def test_another():
    shared_data.append(2)
    assert len(shared_data) == 1  # Fails due to shared state

# Good: Use fixtures for isolation
@pytest.fixture
def data():
    return []

def test_append(data):
    data.append(1)
    assert len(data) == 1
```

## Test Order Dependencies

```python
# Bad: Tests depend on execution order
def test_step_1():
    global user
    user = create_user("Alice")

def test_step_2():
    # Depends on test_step_1 running first
    assert user.name == "Alice"

# Good: Independent tests with fixtures
@pytest.fixture
def user():
    return create_user("Alice")

def test_user_creation(user):
    assert user.name == "Alice"
```

## Dead Waits

```python
# Bad: Arbitrary sleeps
def test_async_operation():
    start_operation()
    time.sleep(5)  # Arbitrary wait
    assert operation_complete()

# Good: Wait for condition
def test_async_operation():
    start_operation()
    wait_for_condition(lambda: operation_complete(), timeout=5)
    assert operation_complete()
```
