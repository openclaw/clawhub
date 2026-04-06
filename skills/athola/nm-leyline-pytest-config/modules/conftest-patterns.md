---
name: conftest-patterns
description: Conftest.py templates and fixtures for standardized pytest configuration across plugins
parent_skill: leyline:pytest-config
category: infrastructure
tags: [pytest, fixtures, conftest, testing]
estimated_tokens: 220
reusable_by:
  - "plugins/*/tests/conftest.py"
  - "test infrastructure setup"
---

# Conftest.py Patterns

Reusable conftest.py templates and fixture patterns for Claude Night Market plugin testing.

## Project-Specific conftest.py Template

```python
"""
Test configuration and shared fixtures for {plugin_name} plugin test suite.

This module provides common fixtures, test data, and utilities
for testing {plugin_name} skills, agents, and workflows.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import Mock

import pytest

# Plugin root for test data
PLUGIN_ROOT = Path(__file__).parent.parent


@pytest.fixture
def plugin_root() -> Path:
    """Return the path to the plugin root directory."""
    return PLUGIN_ROOT


@pytest.fixture
def temp_dir(tmp_path: Path) -> Path:
    """Provide a temporary directory for test isolation."""
    return tmp_path


@pytest.fixture(autouse=True)
def isolate_tests(tmp_path: Path, monkeypatch):
    """Isolate tests by changing to temporary directory."""
    monkeypatch.chdir(tmp_path)
    yield


def pytest_configure(config):
    """Configure custom pytest markers."""
    config.addinivalue_line(
        "markers", "unit: Mark test as unit test"
    )
    config.addinivalue_line(
        "markers", "integration: Mark test as integration test"
    )
    config.addinivalue_line(
        "markers", "slow: Mark test as slow running"
    )
```

## Sample Data Fixtures

```python
@pytest.fixture
def sample_skill_frontmatter() -> str:
    """Sample valid skill frontmatter content."""
    return """---
name: example-skill
description: Example skill for testing
category: testing
tags: [test, example]
tools: [Bash, TodoWrite]
complexity: low
estimated_tokens: 300
---

# Example Skill

## When to Use
Use this skill for testing purposes.
"""


@pytest.fixture
def sample_plugin_json() -> dict:
    """Sample valid plugin.json structure."""
    return {
        "name": "test-plugin",
        "version": "1.0.0",
        "description": "Test plugin for testing",
        "skills": ["./skills/example-skill"],
        "keywords": ["test"],
        "license": "MIT",
    }
```

## Standard Test Markers

### Core Markers

```python
# pytest.ini or pyproject.toml
markers = [
    "unit: marks tests as unit tests (deselect with '-m \"not unit\"')",
    "integration: marks tests as integration tests (deselect with '-m \"not integration\"')",
    "slow: marks tests as slow running (deselect with '-m \"not slow\"')",
    "e2e: marks tests as end-to-end tests",
    "smoke: marks tests as smoke tests for quick validation",
]
```

### Domain-Specific Markers

```python
# For testing-focused plugins
markers = [
    "performance: marks tests as performance-focused",
    "asyncio: marks tests as async-focused",
    "language_detection: marks tests as language detection tests",
]

# For git-focused plugins
markers = [
    "git: marks tests that require git operations",
    "commit: marks tests related to commit workflows",
    "pr: marks tests related to pull request workflows",
]
```

## Test Directory Structure

```
tests/
├── conftest.py           # Shared fixtures
├── __init__.py          # Make tests a package
├── unit/                # Unit tests
│   ├── test_models.py
│   └── test_utils.py
├── integration/         # Integration tests
│   ├── test_api.py
│   └── test_database.py
├── fixtures/            # Test data
│   └── sample_data.json
├── scripts/             # Script tests
│   └── test_cli.py
└── README.md           # Test documentation
```
