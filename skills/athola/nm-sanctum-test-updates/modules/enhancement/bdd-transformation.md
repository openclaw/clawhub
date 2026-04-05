# BDD Transformation Module

## Overview

Transforms traditional tests into BDD-style tests with clear behavior specifications.

## Before: Traditional Test

```python
def test_commit():
    repo = GitRepo()
    repo.add('file.txt')
    result = repo.commit('message')
    assert result is True
```

## After: BDD-Style Test

```python
@pytest.mark.bdd
def test_commit_workflow_with_staged_file():
    """
    GIVEN a Git repository with a staged file
    WHEN the user commits with a message
    THEN the commit should be created successfully
    AND the commit message should match
    """
    # Given
    repo = GitRepo()
    repo.add('file.txt')

    # When
    result = repo.commit('Add new feature')

    # Then
    assert result is True
    assert repo.get_last_commit_message() == 'Add new feature'
```

## Transformation Steps

1. **Add descriptive test name**: Describe behavior, not implementation
2. **Add BDD docstring**: Include Given/When/Then clauses
3. **Structure test with AAA**: Arrange-Act-Assert
4. **Add specific assertions**: Test behavior, not just truthiness

## Benefits

- Clearer test intent
- Better documentation
- Easier maintenance
- Behavior-focused testing
