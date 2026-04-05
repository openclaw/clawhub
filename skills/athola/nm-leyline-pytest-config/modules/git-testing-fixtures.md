---
name: git-testing-fixtures
description: GitRepository helper class and fixtures for testing git-based workflows
parent_skill: leyline:pytest-config
category: infrastructure
tags: [pytest, git, fixtures, testing]
estimated_tokens: 140
reusable_by:
  - "sanctum plugin tests"
  - "git workflow testing"
  - "commit/PR testing"
---

# Git Repository Testing Fixtures

Reusable fixtures for testing git-based workflows and operations.

## GitRepository Helper Class

```python
import subprocess
from pathlib import Path


class GitRepository:
    """Helper class to create and manage test Git repositories."""

    def __init__(self, path: Path):
        self.path = path
        self.git_cmd = ["git", "-C", str(path)]

    def init(self, bare: bool = False) -> None:
        """Initialize a Git repository."""
        cmd = self.git_cmd + ["init", "--bare"] if bare else self.git_cmd + ["init"]
        subprocess.run(cmd, check=True, capture_output=True)

    def config(self, key: str, value: str) -> None:
        """Set Git configuration."""
        subprocess.run(self.git_cmd + ["config", key, value], check=True, capture_output=True)

    def add_file(self, file_path: str, content: str = "") -> Path:
        """Add a file to the repository."""
        full_path = self.path / file_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content)
        return full_path

    def commit(self, message: str = "Test commit") -> str:
        """Create a commit."""
        subprocess.run(self.git_cmd + ["commit", "-m", message], check=True, capture_output=True)
        result = subprocess.run(self.git_cmd + ["rev-parse", "HEAD"],
                               check=True, capture_output=True, text=True)
        return result.stdout.strip()
```

## Git Repository Fixture

```python
import pytest


@pytest.fixture
def temp_git_repo(tmp_path: Path) -> GitRepository:
    """Create a temporary Git repository for testing."""
    repo = GitRepository(tmp_path)
    repo.init()
    repo.config("user.name", "Test User")
    repo.config("user.email", "test@example.com")
    repo.config("init.defaultBranch", "main")
    return repo
```

## Usage Example

```python
def test_git_workflow(temp_git_repo):
    """Test git workflow with temporary repository."""
    # Add a file
    temp_git_repo.add_file("README.md", "# Test Project")

    # Stage and commit
    subprocess.run(["git", "-C", str(temp_git_repo.path), "add", "."], check=True)
    commit_hash = temp_git_repo.commit("Initial commit")

    # Verify commit
    assert len(commit_hash) == 40  # SHA-1 hash
```
