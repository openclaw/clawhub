---
name: mock-fixtures
description: Mock tool fixtures for testing Claude Code tool interactions (Bash, TodoWrite, etc.)
parent_skill: leyline:pytest-config
category: infrastructure
tags: [pytest, mocking, fixtures, tools]
estimated_tokens: 95
reusable_by:
  - "skills testing tool interactions"
  - "agent behavior testing"
  - "command workflow testing"
---

# Mock Tool Fixtures

Fixtures for mocking Claude Code tool interactions in tests.

## Mock Bash Tool

```python
from typing import Any, Dict, List
from unittest.mock import Mock
import pytest


@pytest.fixture
def mock_bash_tool():
    """Mock Bash tool for testing command execution."""
    mock = Mock()

    def mock_execute(command: str, **kwargs):
        """Mock bash execution with common commands."""
        if "git status" in command:
            return "## main...origin/main\nM file1.txt\nA file2.txt\n"
        elif "git diff" in command:
            return "diff --git a/file1.txt b/file1.txt\nindex 123..456 789\n"
        else:
            return ""

    mock.side_effect = mock_execute
    return mock
```

## Mock TodoWrite Tool

```python
@pytest.fixture
def mock_todo_tool():
    """Mock TodoWrite tool for testing task management."""
    mock = Mock()

    def mock_create(todos: List[Dict[str, Any]]):
        """Mock todo creation."""
        return {"status": "success", "todos": todos}

    mock.side_effect = mock_create
    return mock
```

## Usage Example

```python
def test_command_execution(mock_bash_tool):
    """Test command execution with mocked Bash tool."""
    result = mock_bash_tool("git status")
    assert "file1.txt" in result
    assert "file2.txt" in result


def test_todo_creation(mock_todo_tool):
    """Test todo creation with mocked TodoWrite tool."""
    todos = [
        {"content": "Task 1", "status": "pending", "activeForm": "Doing task 1"},
        {"content": "Task 2", "status": "pending", "activeForm": "Doing task 2"},
    ]
    result = mock_todo_tool(todos)
    assert result["status"] == "success"
    assert len(result["todos"]) == 2
```
