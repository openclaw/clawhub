---
parent_skill: pensive:test-review
name: remediation-planning
description: Test improvement strategies and phased remediation
category: testing
tags: [remediation, test-improvement, refactoring]
load_priority: 4
estimated_tokens: 300
---

# Remediation Planning

Concrete strategies for test improvement.

## Test Improvement Patterns

### 1. Add Missing Coverage
Tie tests to specific behaviors using Given/When/Then:

```markdown
### Gap: Authentication edge cases
**Behavior**: Given missing auth token, When hitting /v1/resource, Then HTTP 401 returned
**Test**: `tests/test_auth.py::test_missing_token_returns_401`
**Priority**: High (security boundary)
```

### 2. Refactor Test Helpers

**Before** (repeated setup):
```python
def test_user_creation():
    db = setup_database()
    config = load_test_config()
    user_data = {"email": "alice@example.com", "role": "user"}
    ...

def test_user_deletion():
    db = setup_database()
    config = load_test_config()
    user_data = {"email": "bob@example.com", "role": "admin"}
    ...
```

**After** (fixtures):
```python
@pytest.fixture
def test_db():
    db = setup_database()
    yield db
    db.teardown()

@pytest.fixture
def test_config():
    return load_test_config()

def test_user_creation(test_db, test_config):
    user_data = user_factory(email="alice@example.com")
    ...
```

### 3. Data Builders and Factories

**Factory pattern**:
```python
# conftest.py
def user_factory(**overrides):
    defaults = {
        "email": "user@example.com",
        "role": "user",
        "verified": True,
        "created_at": datetime.now()
    }
    return User(**{**defaults, **overrides})

# test file
def test_admin_access():
    admin = user_factory(role="admin")
    assert admin.can_access_dashboard()
```

**Builder pattern** (Rust):
```rust
struct UserBuilder {
    email: String,
    role: Role,
    verified: bool,
}

impl UserBuilder {
    fn new() -> Self {
        Self {
            email: "user@example.com".to_string(),
            role: Role::User,
            verified: true,
        }
    }

    fn with_role(mut self, role: Role) -> Self {
        self.role = role;
        self
    }

    fn build(self) -> User {
        User { /* ... */ }
    }
}

#[test]
fn test_admin_permissions() {
    let admin = UserBuilder::new().with_role(Role::Admin).build();
    assert!(admin.can_delete_users());
}
```

### 4. Improve Assertions

**Replace magic values**:
```python
# Before
assert response.status == 200

# After
from http import HTTPStatus
assert response.status == HTTPStatus.OK
```

**Add context**:
```python
# Before
assert result

# After
assert result.success, f"Expected success, got error: {result.error}"
```

### 5. Remove Brittle Patterns

**Dead waits** → **Explicit conditions**:
```python
# Before
time.sleep(3)
assert element.visible

# After
wait_for(element.to_be_visible, timeout=5)
```

**Mocking internals** → **Mock boundaries**:
```python
# Before: mocking private implementation
@patch('service._internal_helper')
def test_service(mock):
    ...

# After: mock external dependency
@patch('requests.post')
def test_service(mock_requests):
    ...
```

## Phased Remediation

For major test suite rewrites:

### Phase 1: Stabilize (Week 1-2)
1. Fix flaky tests (eliminate dead waits, order dependencies)
2. Remove duplicate tests
3. Add missing critical path tests
4. **Metric**: Flaky test rate < 1%, critical paths 100%

### Phase 2: Acceptance Specs (Week 3-4)
1. Add BDD scenarios for user-facing features
2. Create feature-to-test mapping
3. Document test strategy per component
4. **Metric**: All features have acceptance tests

### Phase 3: Enforce Quality (Week 5+)
1. Set coverage budgets (80% standard, 100% critical)
2. Add pre-commit hooks for coverage checks
3. Integrate mutation testing for critical code
4. **Metric**: Coverage trends upward, no regressions

## Recommendation Template

```markdown
## Remediation Plan

### Immediate Actions (This Sprint)
1. **Fix flaky test**: `test_user_login_retries` - Replace sleep with explicit wait
   - Owner: @alice
   - Due: 2025-12-10

2. **Add missing coverage**: Password reset flow (currently 0%)
   - Tests needed: valid token, expired token, invalid token
   - Owner: @bob
   - Due: 2025-12-12

### Short-term (Next Sprint)
3. **Refactor fixtures**: Extract common setup in `tests/test_api.py`
   - Pattern: Use pytest fixtures for DB, config
   - Owner: @charlie
   - Due: 2025-12-20

### Long-term (Next Month)
4. **BDD acceptance tests**: User registration feature
   - Tool: Behave/Gherkin
   - Owner: @diana
   - Due: 2025-01-15
```

## Exit Criteria

- [ ] All critical gaps have assigned owners and due dates
- [ ] Recommendations tied to specific behaviors
- [ ] Phased approach for large refactorings
- [ ] Success metrics defined (coverage %, flaky rate, etc.)
