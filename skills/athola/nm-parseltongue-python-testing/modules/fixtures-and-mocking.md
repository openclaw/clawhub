---
name: fixtures-and-mocking
description: Advanced pytest fixtures, parameterized tests, and mocking patterns for external dependencies
category: testing
tags: [python, pytest, fixtures, mocking, parameterization, test-setup]
dependencies: [unit-testing]
estimated_tokens: 500
---

# Fixtures and Mocking

Advanced patterns for test setup, teardown, parameterization, and mocking external dependencies.

## Table of Contents

- [Fixtures for Setup/Teardown](#fixtures-for-setupteardown)
  - [Fixture Scopes](#fixture-scopes)
- [Parameterized Tests](#parameterized-tests)
  - [Multiple Parameters](#multiple-parameters)
- [Mocking External Dependencies](#mocking-external-dependencies)
  - [Mock Patterns](#mock-patterns)
  - [Mocking Best Practices](#mocking-best-practices)
- [Fixture Composition](#fixture-composition)

## Fixtures for Setup/Teardown

Fixtures provide reusable setup and teardown logic:

```python
import pytest
from typing import Generator

@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Fixture that provides database session."""
    session = Session()
    session.begin()
    yield session
    session.rollback()
    session.close()

def test_user_creation(db_session):
    user = User(name="Test")
    db_session.add(user)
    db_session.flush()
    assert user.id is not None
```

Verify: Run `pytest tests/test_fixtures.py -v` to confirm fixtures handle setup/teardown correctly.

### Fixture Scopes

```python
@pytest.fixture(scope="function")  # Default: new instance per test
def user():
    return User(name="Test")

@pytest.fixture(scope="class")  # Shared across test class
def api_client():
    return APIClient()

@pytest.fixture(scope="module")  # Shared across module
def database():
    db = Database()
    db.connect()
    yield db
    db.disconnect()

@pytest.fixture(scope="session")  # Once per test session
def app_config():
    return load_config()
```

## Parameterized Tests

Test multiple inputs efficiently:

```python
@pytest.mark.parametrize("email,is_valid", [
    ("user@example.com", True),
    ("test.user@domain.co.uk", True),
    ("invalid.email", False),
    ("@example.com", False),
    ("", False),
])
def test_email_validation(email, is_valid):
    assert validate_email(email) == is_valid
```

### Multiple Parameters

```python
@pytest.mark.parametrize("input_value,expected", [
    (0, "zero"),
    (1, "one"),
    (5, "many"),
])
@pytest.mark.parametrize("locale", ["en", "es", "fr"])
def test_number_formatting(input_value, expected, locale):
    result = format_number(input_value, locale)
    assert result is not None  # Locale-specific checks
```

## Mocking External Dependencies

Mock external services and APIs:

```python
from unittest.mock import Mock, patch

@patch("requests.get")
def test_api_client(mock_get):
    mock_get.return_value.json.return_value = {"id": 1, "name": "Test"}
    mock_get.return_value.raise_for_status.return_value = None

    client = APIClient("https://api.example.com")
    user = client.get_user(1)

    assert user["id"] == 1
    mock_get.assert_called_once()
```

### Mock Patterns

```python
# Mock with return value
mock_service = Mock(return_value={"status": "success"})

# Mock with side effects
mock_service = Mock(side_effect=[ValueError(), {"data": "ok"}])

# Mock attributes
mock_obj = Mock()
mock_obj.user.email = "test@example.com"

# Verify mock calls
mock_service.assert_called_once_with(param="value")
mock_service.assert_called_with(param="value")
assert mock_service.call_count == 2
```

### Mocking Best Practices

1. **Mock at boundaries** - Only mock external dependencies (APIs, databases, file systems)
2. **Don't over-mock** - Avoid mocking simple calculations or pure functions
3. **Use patch decorators** - Apply `@patch` at the usage location, not definition
4. **Verify interactions** - Use `assert_called_*` to verify expected calls
5. **Return realistic data** - Mock responses should match actual API responses

## Fixture Composition

Combine fixtures for complex setups:

```python
@pytest.fixture
def admin_user(db_session):
    user = User(name="Admin", role="admin")
    db_session.add(user)
    db_session.flush()
    return user

@pytest.fixture
def authenticated_client(admin_user):
    client = APIClient()
    client.authenticate(admin_user)
    return client

def test_admin_endpoint(authenticated_client):
    response = authenticated_client.get("/admin/users")
    assert response.status_code == 200
```
