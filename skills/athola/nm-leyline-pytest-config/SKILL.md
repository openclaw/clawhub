---
name: pytest-config
description: |
  'Standardized pytest configuration for Claude Night Market plugin testing with reusable fixtures and CI integration
version: 1.8.1
triggers:
  - pytest
  - testing
  - configuration
  - fixtures
  - configuring pytest
  - setting up conftest patterns
  - or establishing shared test fixtures
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.leyline:testing-quality-standards"]}}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [Detailed Patterns](#detailed-patterns)
- [Integration with Other Skills](#integration-with-other-skills)
- [Exit Criteria](#exit-criteria)
- [Troubleshooting](#troubleshooting)

# Pytest Configuration Patterns

Standardized pytest configuration and patterns for consistent testing infrastructure across Claude Night Market plugins.


## When To Use

- Setting up pytest configuration and fixtures
- Configuring conftest.py patterns for test infrastructure

## When NOT To Use

- Non-Python projects or projects using other test frameworks
- Simple scripts that do not need test infrastructure

## Quick Start

### Basic pyproject.toml Configuration

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = [
    "-v",
    "--cov=src",
    "--cov-report=term-missing",
    "--cov-fail-under=80",
    "--strict-markers",
]
markers = [
    "unit: marks tests as unit tests",
    "integration: marks tests as integration tests",
    "slow: marks tests as slow running",
]

[tool.coverage.run]
source = ["src"]
omit = ["*/tests/*", "*/migrations/*", "*/__pycache__/*"]
branch = true

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "def __str__",
    "raise NotImplementedError",
    "if __name__ == .__main__.:",
    "if TYPE_CHECKING:",
    "class .*\\bProtocol\\):",
    "@(abc\\.)?abstractmethod",
]
precision = 2
show_missing = true
```
**Verification:** Run `pytest --collect-only` to verify discovery, `pytest -v --co -q` for markers, and `pytest --cov` for coverage thresholds.

## Detailed Patterns

For detailed implementation patterns, see:

- **[Conftest Patterns](modules/conftest-patterns.md)** - Conftest.py templates, fixtures, test markers, and directory structure
- **[Git Testing Fixtures](modules/git-testing-fixtures.md)** - GitRepository helper class for testing git workflows
- **[Mock Fixtures](modules/mock-fixtures.md)** - Mock tool fixtures for Bash, TodoWrite, and other Claude Code tools
- **[CI Integration](modules/ci-integration.md)** - GitHub Actions workflows and test commands for automated testing
- **Module Index**: See `modules/README.md` for module organization overview

## Integration with Other Skills

This skill provides foundational patterns referenced by:
- `parseltongue:python-testing` - Uses pytest configuration and fixtures
- `pensive:test-review` - Uses test quality standards
- `sanctum:test-*` - Uses conftest patterns and Git fixtures

Reference in your skill's frontmatter:
```yaml
dependencies: [leyline:pytest-config, leyline:testing-quality-standards]
```

## Exit Criteria

- pytest configuration standardized across plugins
- conftest.py provides reusable fixtures
- test markers defined and documented
- coverage configuration enforces quality thresholds
- CI/CD integration configured for automated testing
## Troubleshooting

### Common Issues

**Tests not discovered**
Ensure test files match pattern `test_*.py` or `*_test.py`. Run `pytest --collect-only` to verify.

**Import errors**
Check that the module being tested is in `PYTHONPATH` or install with `pip install -e .`

**Async tests failing**
Install pytest-asyncio and decorate test functions with `@pytest.mark.asyncio`
