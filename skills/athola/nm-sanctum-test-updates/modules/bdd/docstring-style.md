# Docstring BDD Style Module

## Overview

Simple BDD pattern using docstrings for quick behavior documentation and simple unit tests.

## Structure Example

```python
def test_git_status_parsing():
    """Test parsing git status output.

    GIVEN git status output with modified and untracked files
    WHEN parsing the status
    THEN it should return structured file information
    AND correctly identify file states
    """
    status_output = """
    M modified_file.py
    A  added_file.py
    ?? untracked_file.py
    """

    result = parse_git_status(status_output)

    assert 'modified_file.py' in result.modified
    assert 'added_file.py' in result.added
    assert 'untracked_file.py' in result.untracked
```

## Best Practices

- **Clear docstrings**: Include Given/When/Then
- **Simple structure**: Ideal for utilities and helpers
- **Quick documentation**: Minimal overhead for behavior specs
- **Focused tests**: One clear behavior per test

## When to Use

- Simple unit tests
- Internal module testing
- Quick behavior documentation
- Utility function testing
