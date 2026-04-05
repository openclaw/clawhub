# Edge Case Expansion Module

## Overview

Systematically adds detailed edge case testing to existing tests.

## The Rule of Three

For every assertion, add:
1. **Positive case**: Expected behavior
2. **Negative case**: Error handling
3. **Edge case**: Boundary condition

## Example Expansion

**Original:**
```python
def test_parse_number():
    assert parse_number("123") == 123
```

**Enhanced:**
```python
@pytest.mark.parametrize("input_str,expected,description", [
    ("123", 123, "valid positive integer"),
    ("-456", -456, "valid negative integer"),
    ("0", 0, "zero value"),
    ("3.14", 3.14, "valid float"),
    ("1e5", 100000, "scientific notation"),
])
def test_parse_number_valid_inputs(input_str, expected, description):
    """
    GIVEN various valid number strings
    WHEN parsing the string
    THEN it should return the correct number
    """
    assert parse_number(input_str) == expected

@pytest.mark.parametrize("invalid_input", [
    "abc",
    "",
    "12.34.56",
    "1,234",
    None,
])
def test_parse_number_invalid_inputs(invalid_input):
    """
    GIVEN invalid number inputs
    WHEN parsing the string
    THEN it should raise a ValueError
    """
    with pytest.raises(ValueError):
        parse_number(invalid_input)
```

## Common Edge Cases

- **Strings**: Empty, whitespace, special characters, unicode
- **Numbers**: Zero, negative, maximum/minimum values, infinity
- **Collections**: Empty, single item, maximum capacity
- **Dates**: Leap years, timezone changes, daylight saving
- **Files**: Missing, permissions, full disk, network errors
