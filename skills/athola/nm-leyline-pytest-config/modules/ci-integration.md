---
name: ci-integration
description: GitHub Actions workflows and CI/CD integration patterns for pytest
parent_skill: leyline:pytest-config
category: infrastructure
tags: [pytest, ci-cd, github-actions, automation]
estimated_tokens: 120
reusable_by:
  - ".github/workflows/test.yml"
  - "CI/CD pipeline setup"
  - "automated testing workflows"
---

# CI/CD Integration

GitHub Actions workflows and test commands for automated testing.

## Common Test Commands

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific markers
pytest -m unit
pytest -m "not slow"

# Run failed tests first
pytest --failed-first

# Parallel execution
pytest -n auto

# Verbose output with print statements
pytest -v -s

# Stop on first failure
pytest -x

# Show local variables in tracebacks
pytest -l
```

## GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - run: pytest --cov --cov-report=xml
      - uses: codecov/codecov-action@v4
```

## Multi-Python Version Testing

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - run: pip install -e ".[dev]"
      - run: pytest --cov --cov-report=xml
      - uses: codecov/codecov-action@v4
        if: matrix.python-version == '3.12'
```

## Makefile Integration

```makefile
.PHONY: test
test:
	pytest

.PHONY: test-cov
test-cov:
	pytest --cov=src --cov-report=html --cov-report=term

.PHONY: test-fast
test-fast:
	pytest -m "not slow" -x

.PHONY: test-verbose
test-verbose:
	pytest -v -s
```
