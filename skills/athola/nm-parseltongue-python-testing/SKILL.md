---
name: python-testing
description: |
  Python testing patterns: pytest setup, fixtures, TDD, mocking, async tests, and integration tests
version: 1.8.1
triggers:
  - python
  - testing
  - pytest
  - tdd
  - test-automation
  - quality-assurance
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/parseltongue", "emoji": "\ud83e\uddea"}}
source: claude-night-market
source_plugin: parseltongue
---

> **Night Market Skill** — ported from [claude-night-market/parseltongue](https://github.com/athola/claude-night-market/tree/master/plugins/parseltongue). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Python Testing Hub

Testing standards for pytest configuration, fixture management, and TDD implementation.

## Table of Contents

1. [Quick Start](#quick-start)
2. [When to Use](#when-to-use)
3. [Modules](#modules)

## Quick Start

1.  **Dependencies**: `pip install pytest pytest-cov pytest-asyncio pytest-mock`
2.  **Configuration**: Add the following to `pyproject.toml`:
    ```toml
    [tool.pytest.ini_options]
    testpaths = ["tests"]
    addopts = "--cov=src"
    ```
3.  **Verification**: Run `pytest` to confirm discovery of files matching `test_*.py`.

## When To Use

- Constructing unit and integration tests for Python 3.9+ projects.
- Isolating external dependencies using `pytest-mock` or custom monkeypatching.
- Validating asynchronous logic with `pytest-asyncio` markers and event loop management.
- Configuring project-wide coverage thresholds and reporting.

## When NOT To Use

- Evaluating test
  quality - use pensive:test-review instead
- Infrastructure test
  config - use leyline:pytest-config
- Evaluating test
  quality - use pensive:test-review instead
- Infrastructure test
  config - use leyline:pytest-config

## Modules

This skill uses modular loading to manage the system prompt budget.

### Core Implementation
- See `modules/unit-testing.md` - AAA (Arrange-Act-Assert) pattern, basic test structure, and exception validation.
- See `modules/fixtures-and-mocking.md` - Request-scoped fixtures, parameterization, and boundary mocking.
- See `modules/async-testing.md` - Coroutine testing, async fixtures, and concurrency validation.

### Infrastructure & Workflow
- See `modules/test-infrastructure.md` - Directory standards, `conftest.py` management, and coverage tools.
- See `modules/testing-workflows.md` - Local execution patterns and GitHub Actions integration.

### Standards
- See `modules/test-quality.md` - Identification of common anti-patterns like broad exception catching or shared state between tests.

## Exit Criteria

- Tests implement the AAA pattern.
- Coverage reaches the 80% project minimum.
- Individual tests are independent and do not rely on execution order.
- Fixtures are scoped appropriately (function, class, or session) to prevent side effects.
- Mocking is restricted to external system boundaries.

## Troubleshooting

- **Test Discovery**: Verify filenames match the `test_*.py` pattern. Use `pytest --collect-only` to debug discovery paths.
- **Import Errors**: Ensure the local source directory is in the path, typically by installing in editable mode with `pip install -e .`.
- **Async Failures**: Confirm that `pytest-asyncio` is installed and that async tests use the `@pytest.mark.asyncio` decorator or corresponding auto-mode configuration.
