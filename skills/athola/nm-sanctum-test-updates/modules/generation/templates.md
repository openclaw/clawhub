# Test Templates Module

## Overview

Standard templates for different types of tests following BDD patterns.

## Function Test Template

```python
def test_{function_name}_{scenario}():
    """
    GIVEN {given_context}
    WHEN {when_action}
    THEN {then_expected}
    """
    # TODO: Arrange - Set up test context
    # TODO: Act - Execute the function
    # TODO: Assert - Verify the outcome
    pass
```

## Class Test Template

```python
class Test{ClassName}:
    """BDD-style tests for {ClassName} behavior."""

    def setup_method(self):
        """Setup test instance."""
        self.instance = {ClassName}()

    @pytest.mark.bdd
    def test_{method_name}_{scenario}(self):
        """
        GIVEN {given_context}
        WHEN {when_action}
        THEN {then_expected}
        """
        # TODO: Implement test following BDD pattern
        pass

    def teardown_method(self):
        """Cleanup after each test."""
        pass
```

## API Test Template

```python
@pytest.mark.bdd
def test_{endpoint}_{method}_{scenario}(client):
    """
    GIVEN {given_context}
    WHEN making {method} request to {endpoint}
    THEN response should be {expected_status}
    AND response should contain {expected_content}
    """
    # TODO: Setup request data
    # TODO: Make API call
    # TODO: Verify response
    pass
```

## Using Templates

Templates provide scaffolding that developers complete using TDD:
1. Write the failing test (RED)
2. Implement minimal code to pass (GREEN)
3. Refactor for clarity (REFACTOR)
