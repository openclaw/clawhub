---
name: testing-workflows
description: Running tests, CI/CD integration, and automated testing workflows
category: testing
tags: [python, pytest, ci-cd, github-actions, automation, workflow]
dependencies: [test-infrastructure]
estimated_tokens: 325
---

# Testing Workflows

Running tests effectively and integrating with CI/CD pipelines.

## Table of Contents

- [Running Tests](#running-tests)
- [CI/CD Integration](#ci-cd-integration)
  - [GitHub Actions](#github-actions)
  - [GitLab CI](#gitlab-ci)
- [Pre-commit Hooks](#pre-commit-hooks)
- [Makefile Integration](#makefile-integration)
- [Coverage Reporting](#coverage-reporting)
  - [HTML Report](#html-report)
  - [Terminal Report](#terminal-report)
  - [XML Report (for CI)](#xml-report-for-ci)
- [Debugging Tests](#debugging-tests)

## Running Tests

Common pytest commands:

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

# Run specific test file
pytest tests/unit/test_models.py

# Run specific test function
pytest tests/unit/test_models.py::test_user_creation

# Verbose output
pytest -v

# Show print statements
pytest -s

# Stop on first failure
pytest -x

# Run last failed tests
pytest --lf
```

## CI/CD Integration

### GitHub Actions

Complete workflow in `.github/workflows/test.yml`:

```yaml
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

      - name: Install dependencies
        run: |
          pip install -e ".[dev]"

      - name: Run tests
        run: pytest --cov --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        if: matrix.python-version == '3.12'
```

### GitLab CI

`.gitlab-ci.yml` configuration:

```yaml
test:
  image: python:3.12
  before_script:
    - pip install -e ".[dev]"
  script:
    - pytest --cov --cov-report=term --cov-report=xml
  coverage: '/TOTAL.*\s+(\d+%)$/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
```

## Pre-commit Hooks

Add testing to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: pytest-check
        name: pytest
        entry: pytest
        language: system
        pass_filenames: false
        always_run: true
        stages: [commit]
```

## Makefile Integration

Convenient test commands in `Makefile`:

```makefile
.PHONY: test test-fast test-cov test-watch

test:
	pytest -v

test-fast:
	pytest -m "not slow" -x

test-cov:
	pytest --cov=src --cov-report=html --cov-report=term

test-watch:
	pytest-watch -c
```

## Coverage Reporting

### HTML Report

```bash
pytest --cov=src --cov-report=html
open htmlcov/index.html  # View in browser
```

### Terminal Report

```bash
pytest --cov=src --cov-report=term-missing
```

### XML Report (for CI)

```bash
pytest --cov=src --cov-report=xml
```

## Debugging Tests

```bash
# Drop into debugger on failure
pytest --pdb

# Drop into debugger at test start
pytest --trace

# Show local variables on failure
pytest -l

# Show full diff output
pytest -vv
```
