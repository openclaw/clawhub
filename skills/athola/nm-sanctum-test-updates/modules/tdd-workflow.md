# TDD Workflow Module

## Table of Contents
- [Overview](#overview)
- [The TDD Cycle](#the-tdd-cycle)
  - [RED Phase: Write Failing Test](#red-phase-write-failing-test)
  - [GREEN Phase: Minimal Implementation](#green-phase-minimal-implementation)
  - [REFACTOR Phase: Clean Up](#refactor-phase-clean-up)
- [TDD Discipline Rules](#tdd-discipline-rules)
- [Error Handling in TDD](#error-handling-in-tdd)
- [Advanced TDD Patterns](#advanced-tdd-patterns)

## Overview

Implements strict Test-Driven Development workflow with RED-GREEN-REFACTOR cycle. This module validates all test creation follows proper TDD discipline.

## The TDD Cycle

### RED Phase: Write Failing Test

**Principles:**
- Write ONE test at a time
- Test must FAIL for the right reason
- No production code exists yet
- Test describes desired behavior

**Implementation Pattern:**
```python
def test_new_feature_behavior():
    """
    GIVEN a specific context
    WHEN an action is performed
    THEN expected outcome occurs
    """
    # Arrange - Set up test context
    context = create_test_context()

    # Act - Execute the behavior
    result = perform_action(context)

    # Assert - Verify the outcome
    assert result == expected_value

# Run and verify it fails: pytest -xvs test_file.py::test_new_feature_behavior
```

### Verification Steps
1. **Run the test**: Must fail
2. **Check failure reason**: Should be "feature not implemented"
3. **Confirm test quality**: Clear, focused, one behavior

### GREEN Phase: Minimal Implementation

**Principles:**
- Write simplest code to pass
- No extra features
- Don't fix other tests
- Keep it ugly if it works

**Implementation Pattern:**
```python
# Minimal implementation - just enough to pass
def perform_action(context):
    if context.should_succeed:
        return expected_value
    raise NotImplementedError("Feature not yet implemented")
```

### Verification Steps
1. **Run the test**: Must pass
2. **Check other tests**: All still passing
3. **No warnings/errors**: Clean execution

### REFACTOR Phase: Clean Up

**Principles:**
- Tests must stay green
- Remove duplication
- Improve names and structure
- Add necessary abstractions

**Refactoring Checklist:**
- [ ] Extract magic numbers to constants
- [ ] Improve variable names
- [ ] Remove code duplication
- [ ] Add helpful comments
- [ ] validate single responsibility

## TDD Discipline Rules

### Iron Rules
1. **NO production code without a failing test first**
2. **Watch it fail** - Don't skip this step
3. **Write minimal code** - No extra features
4. **Refactor only when green** - Clean up with safety net

### Common Violations to Avoid
- Writing code before tests
- "I'll test it after" mentality
- Keeping implementation as "reference"
- Skipping the failure verification
- Adding extra features in GREEN phase

## Error Handling in TDD

### Test Errors vs Failures
- **Error**: Syntax, imports, setup issues - Fix immediately
- **Failure**: Assertion fails - Good! This is expected

### Debugging Process
1. Test fails unexpectedly → Check test logic
2. Implementation doesn't work → Simplify further
3. Other tests break → Check for side effects

## Advanced TDD Patterns

### Outside-In TDD
- Start with acceptance/feature tests
- Work inward to unit tests
- Maintain failing test chain

### Mocking Strategies
- Mock external dependencies
- Use dependency injection
- Test behavior, not implementation

### Parameterized Tests
```python
@pytest.mark.parametrize("input,expected", [
    ("valid_input", "expected_output"),
    ("edge_case", "edge_output"),
])
def test_multiple_scenarios(input, expected):
    assert process(input) == expected
```
