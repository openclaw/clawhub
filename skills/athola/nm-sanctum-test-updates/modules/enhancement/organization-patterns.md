# Organization Patterns Module

## Overview

Restructures tests for better maintainability and clarity.

## Test Organization Example

```python
class TestGitRepository:
    """BDD-style test suite for GitRepository operations."""

    @pytest.fixture(autouse=True)
    def setup_repo(self, tmp_path):
        """Setup a test repository for each test."""
        self.repo_path = tmp_path / "test_repo"
        self.repo = GitRepository(self.repo_path)
        self.repo.init()

    @pytest.mark.bdd
    def test_init_creates_git_directory(self):
        """
        GIVEN a directory path
        WHEN initializing a git repository
        THEN it should create a .git directory
        """
        assert (self.repo_path / ".git").exists()

    @pytest.mark.bdd
    def test_init_with_existing_repo_raises_error(self):
        """
        GIVEN an existing git repository
        WHEN initializing again
        THEN it should raise RepositoryError
        """
        with pytest.raises(RepositoryError):
            GitRepository(self.repo_path).init()
```

## AAA Pattern (Arrange-Act-Assert)

```python
def test_workflow():
    # Arrange - Setup everything needed
    context = create_test_context()
    expected = prepare_expected_result()

    # Act - Perform the action
    result = perform_action(context)

    # Assert - Verify outcomes
    assert result == expected
```

## Test Data Factory Pattern

```python
class TestDataFactory:
    """Factory for creating test data."""

    @staticmethod
    def create_git_repo(branch="main", with_commits=False):
        repo = GitRepository()
        repo.init(branch)

        if with_commits:
            repo.add("README.md")
            repo.commit("Initial commit")

        return repo

    @staticmethod
    def create_user(role="user", **overrides):
        default_user = {
            "name": "Test User",
            "email": "test@example.com",
            "role": role,
        }
        default_user.update(overrides)
        return User(**default_user)
```
