---
name: test-infrastructure
description: Project configuration for pytest including pyproject.toml setup, test directory structure, and coverage configuration
category: testing
tags: [python, pytest, configuration, project-setup, coverage]
dependencies: []
estimated_tokens: 300
---

# Test Infrastructure

Configuration and structure for Python test suites.

## Table of Contents

- [pyproject.toml Configuration](#pyprojecttoml-configuration)
- [Test Directory Structure](#test-directory-structure)
- [conftest.py](#conftestpy)
- [Dependencies](#dependencies)
- [Coverage Configuration](#coverage-configuration)

## pyproject.toml Configuration

Complete pytest configuration in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
addopts = [
    "-v",
    "--cov=src",
    "--cov-report=term-missing",
    "--cov-fail-under=80",
]
markers = [
    "slow: marks tests as slow",
    "integration: marks integration tests",
    "unit: marks unit tests",
]

[tool.coverage.run]
source = ["src"]
omit = ["*/tests/*", "*/migrations/*"]

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "raise NotImplementedError",
]
```

Verify: Run `pytest --collect-only` to confirm test discovery works with this configuration.

## Test Directory Structure

Organized test layout:

```
tests/
├── conftest.py           # Shared fixtures
├── unit/                 # Unit tests
│   ├── test_models.py
│   └── test_utils.py
├── integration/          # Integration tests
│   ├── test_api.py
│   └── test_database.py
└── fixtures/             # Test data
    └── sample_data.json
```

## conftest.py

Shared fixtures and configuration:

```python
import pytest
from pathlib import Path

@pytest.fixture
def fixtures_path() -> Path:
    """Path to test fixtures directory."""
    return Path(__file__).parent / "fixtures"

@pytest.fixture
def sample_data(fixtures_path):
    """Load sample test data."""
    import json
    with open(fixtures_path / "sample_data.json") as f:
        return json.load(f)

# Pytest configuration hooks
def pytest_configure(config):
    """Configure pytest."""
    config.addinivalue_line("markers", "smoke: Quick smoke tests")

def pytest_collection_modifyitems(items):
    """Modify test collection."""
    for item in items:
        if "integration" in item.nodeid:
            item.add_marker(pytest.mark.slow)
```

## Dependencies

Add testing dependencies to `pyproject.toml`:

```toml
[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-cov>=4.1.0",
    "pytest-asyncio>=0.23.0",
    "pytest-xdist>=3.5.0",  # Parallel execution
    "pytest-mock>=3.12.0",
]
```

## Coverage Configuration

Fine-tune coverage reporting:

```toml
[tool.coverage.run]
source = ["src"]
branch = true  # Branch coverage
omit = [
    "*/tests/*",
    "*/migrations/*",
    "*/__init__.py",
]

[tool.coverage.report]
precision = 2
skip_empty = true
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "def __str__",
    "raise AssertionError",
    "raise NotImplementedError",
    "if __name__ == .__main__.:",
    "if TYPE_CHECKING:",
    "@abstractmethod",
]
```
