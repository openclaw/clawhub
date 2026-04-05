---
name: unit-testing
description: Fundamental unit testing patterns with pytest including AAA pattern, basic test structure, and exception testing
category: testing
tags: [python, pytest, unit-testing, test-structure, aaa-pattern]
dependencies: []
estimated_tokens: 425
---

# Unit Testing Fundamentals

Core patterns for writing effective unit tests with pytest.

## Test Structure (AAA Pattern)

The Arrange-Act-Assert pattern provides clear test organization:

```python
def test_user_creation():
    # Arrange
    data = {"email": "test@example.com", "name": "Test User"}

    # Act
    user = User.create(**data)

    # Assert
    assert user.email == data["email"]
    assert user.is_valid()
```

## Basic pytest Tests

Simple test examples demonstrating pytest fundamentals:

```python
import pytest

class Calculator:
    def divide(self, a: float, b: float) -> float:
        if b == 0:
            raise ValueError("Cannot divide by zero")
        return a / b

def test_division():
    calc = Calculator()
    assert calc.divide(6, 3) == 2

def test_division_by_zero():
    calc = Calculator()
    with pytest.raises(ValueError, match="Cannot divide by zero"):
        calc.divide(5, 0)
```

## Key Principles

1. **One test, one behavior** - Each test validates a single behavior
2. **Independent tests** - Tests should not depend on each other
3. **Descriptive names** - Use names like `test_user_creation_with_invalid_email_raises_error`
4. **Clear assertions** - Make test intent obvious through assertion messages

## Common Assertions

```python
# Equality
assert result == expected

# Boolean checks
assert user.is_active
assert not user.is_deleted

# Exception testing
with pytest.raises(ValueError):
    validate_email("invalid")

# Exception with message matching
with pytest.raises(ValueError, match="Cannot divide by zero"):
    divide(5, 0)

# Collection membership
assert "admin" in user.roles
assert user.id not in deleted_ids
```
