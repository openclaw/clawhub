# pytest BDD Style Module

## Overview

BDD-style pytest tests with descriptive names and docstrings for unit and API testing.

## Structure Example

```python
class TestGitWorkflow:
    """BDD-style tests for Git workflow operations."""

    @pytest.mark.bdd
    def test_commit_workflow_with_staged_changes(self):
        """
        GIVEN a Git repository with staged changes
        WHEN the user runs the commit workflow
        THEN it should create a commit with proper message format
        AND all tests should pass
        """
        # Given
        repo = create_git_repo()
        repo.stage_changes(['feature.py'])

        # When
        result = run_commit_workflow(repo)

        # Then
        assert result.success is True
        assert repo.has_commit()
        assert repo.last_commit_message().startswith('feat:')

    @pytest.mark.bdd
    def test_commit_workflow_rejects_empty_changes(self):
        """
        GIVEN a Git repository with no staged changes
        WHEN the user runs the commit workflow
        THEN it should reject with appropriate error message
        """
        # Given
        repo = create_git_repo()  # No changes staged

        # When
        result = run_commit_workflow(repo)

        # Then
        assert result.success is False
        assert "no staged changes" in result.error.lower()
```

## Best Practices

- **Descriptive names**: Describe behavior, not implementation
- **Clear sections**: Use Given/When/Then in docstrings
- **Single responsibility**: One behavior per test
- **Meaningful assertions**: Test specific outcomes

## When to Use

- Unit tests with behavior focus
- API testing
- Service layer testing
- Developer-facing documentation
