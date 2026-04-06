---
parent_skill: pensive:test-review
name: scenario-quality
description: Test scenario quality assessment with BDD patterns
category: testing
tags: [bdd, scenario-quality, assertions, anti-patterns]
load_priority: 3
estimated_tokens: 350
---

# Scenario Quality Assessment

Evaluate test quality using BDD principles and assertion patterns.

## Given/When/Then Clarity

### Good Examples

**Rust:**
```rust
#[test]
fn test_authenticated_user_can_access_profile() {
    // Given: authenticated user
    let user = create_authenticated_user("alice@example.com");
    let token = generate_token(&user);

    // When: accessing profile endpoint
    let response = get("/profile", &token);

    // Then: profile data returned
    assert_eq!(response.status, 200);
    assert_eq!(response.body["email"], "alice@example.com");
}
```

**Python:**
```python
def test_invalid_credentials_rejected():
    # Given: user with wrong password
    user = User(email="bob@example.com")
    wrong_password = "incorrect"

    # When: attempting authentication
    result = authenticate(user.email, wrong_password)

    # Then: authentication fails with 401
    assert result.status_code == 401
    assert "invalid credentials" in result.error_message
```

**Gherkin (BDD):**
```gherkin
Scenario: Registered user logs in successfully
  Given a registered user with email "alice@example.com"
  When they submit valid credentials
  Then they receive an authentication token
  And the token expires in 24 hours
```

## Assertion Quality

### Bad Assertions (vague, brittle)
```python
# Too vague
assert result

# Multiple unrelated assertions
assert len(users) > 0 and users[0].active and config.debug

# Magic numbers without context
assert response.status == 200
```

### Good Assertions (specific, meaningful)
```python
# Specific outcome
assert result.status_code == 200, "Expected successful login"

# Named constants
assert response.status == HTTP_OK
assert user.role == UserRole.ADMIN

# Structured assertions
assert response.json() == {
    "user": {"email": expected_email, "verified": True},
    "token": {"expires_at": ANY_DATETIME}
}
```

## Anti-Patterns to Flag

### 1. Dead Waits
```python
# BAD: arbitrary sleep
time.sleep(5)
assert element.is_visible()

# GOOD: explicit wait with condition
wait_until(lambda: element.is_visible(), timeout=5)
```

### 2. Mocking Internals
```python
# BAD: mocking implementation details
@patch('module.internal._private_helper')
def test_feature(mock_helper):
    ...

# GOOD: mock external dependencies only
@patch('requests.get')
def test_api_call(mock_get):
    ...
```

### 3. Repeated Boilerplate
```python
# BAD: copy-pasted setup
def test_user_creation():
    db = Database("test.db")
    db.connect()
    user = User("alice")
    ...

def test_user_deletion():
    db = Database("test.db")
    db.connect()
    user = User("bob")
    ...

# GOOD: fixture/helper
@pytest.fixture
def db_session():
    db = Database("test.db")
    db.connect()
    yield db
    db.close()
```

### 4. Order Dependencies
```python
# BAD: tests depend on execution order
def test_01_create_user():
    global user_id
    user_id = create_user()

def test_02_delete_user():
    delete_user(user_id)  # Depends on test_01!

# GOOD: isolated tests
def test_delete_user():
    user_id = create_user()  # Self-contained
    delete_user(user_id)
    assert not user_exists(user_id)
```

### 5. Multiple Assertions Without Context
```python
# BAD: unclear which assertion failed
assert user.active
assert user.verified
assert user.role == "admin"

# GOOD: grouped with context or separate tests
assert user.active, "User should be active"
assert user.verified, "User should be verified"
assert user.role == "admin", "User should have admin role"
```

## BDD Suite Quality

### Reusable Step Definitions
```python
# Good: parameterized, reusable
@given('a user with email "{email}"')
def create_user(context, email):
    context.user = User(email=email)

@when('they submit credentials with password "{password}"')
def submit_credentials(context, password):
    context.response = authenticate(context.user.email, password)
```

### Background Context Sharing
```gherkin
Feature: User authentication

  Background:
    Given a clean database
    And the authentication service is running

  Scenario: Valid login
    Given a registered user
    ...
```

### Scenario Outlines for Edge Cases
```gherkin
Scenario Outline: Password validation
  Given a user registering with password "<password>"
  When they submit the registration form
  Then they receive response "<outcome>"

  Examples:
    | password    | outcome           |
    | abc         | too_short         |
    | password123 | no_special_chars  |
    | P@ssw0rd!   | success           |
```

## Quality Scoring

Score each test file 1-5 on:
- **Clarity**: Given/When/Then structure evident
- **Assertions**: Specific, meaningful checks
- **Isolation**: No shared state or order dependencies
- **Maintainability**: DRY, uses fixtures/helpers
- **Coverage**: Tests behavior, not implementation

**Overall quality**:
- 4-5: Excellent, minimal changes needed
- 3: Good, some improvements recommended
- 1-2: Poor, significant refactoring required
