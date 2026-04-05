---
name: python-packaging
description: |
  Python package creation and distribution: pyproject.toml, entry points, PyPI publishing, CI/CD
version: 1.8.1
triggers:
  - python
  - packaging
  - pyproject.toml
  - uv
  - pip
  - pypi
  - distribution
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/parseltongue", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: parseltongue
---

> **Night Market Skill** — ported from [claude-night-market/parseltongue](https://github.com/athola/claude-night-market/tree/master/plugins/parseltongue). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [Core Decisions](#core-decisions)
- [1. Layout Choice](#1-layout-choice)
- [2. Project Structure](#2-project-structure)
- [Detailed Topics](#detailed-topics)
- [Best Practices](#best-practices)
- [Exit Criteria](#exit-criteria)


# Python Packaging

Modern Python packaging with pyproject.toml, uv, and best practices for distribution.

## Quick Start

```bash
# Create new project with uv
uv init my-package
cd my-package

# Add dependencies
uv add requests click

# Build package
uv build

# Publish to PyPI
uv publish
```
**Verification:** Run the command with `--help` flag to verify availability.

## When To Use

- Creating distributable Python libraries
- Building CLI tools
- Publishing to PyPI
- Setting up development environments
- Managing project dependencies

## When NOT To Use

- Testing packages - use python-testing
  instead
- Optimizing package performance - use python-performance
- Testing packages - use python-testing
  instead
- Optimizing package performance - use python-performance

## Core Decisions

### 1. Layout Choice

```yaml
# Source layout (recommended)
src/my_package/
    __init__.py
    module.py

# Flat layout (simple)
my_package/
    __init__.py
    module.py
```
**Verification:** Run the command with `--help` flag to verify availability.

**Source layout benefits:**
- Clear separation of source and tests
- Prevents accidental imports of uninstalled code
- Better for packages with complex structure

### 2. Project Structure

**Minimal Project:**
```
**Verification:** Run `pytest -v` to verify tests pass.
my-project/
├── pyproject.toml
├── README.md
├── src/
│   └── my_package/
│       └── __init__.py
└── tests/
    └── test_init.py
```
**Verification:** Run `pytest -v` to verify tests pass.

**Complete Project:**
```
**Verification:** Run the command with `--help` flag to verify availability.
my-project/
├── pyproject.toml
├── README.md
├── LICENSE
├── .gitignore
├── src/
│   └── my_package/
│       ├── __init__.py
│       ├── cli.py
│       ├── core.py
│       └── utils.py
├── tests/
│   ├── conftest.py
│   └── test_core.py
└── docs/
    └── index.md
```
**Verification:** Run `pytest -v` to verify tests pass.

## Detailed Topics

See modules for detailed information:

- **[uv Workflow](modules/uv-workflow.md)** - Complete uv commands and troubleshooting
- **[pyproject.toml Patterns](modules/pyproject-patterns.md)** - Configuration examples for different package types
- **[Entry Points](modules/entry-points.md)** - Console scripts, GUI scripts, and plugins
- **[CI/CD Integration](modules/ci-cd-integration.md)** - GitHub Actions and automated publishing

## Best Practices

1. **Use source layout** for anything beyond simple packages
2. **Pin direct dependencies** with minimum versions
3. **Use optional dependency groups** for dev/docs/test
4. **Include py.typed** for type hint support
5. **Add detailed README** with usage examples
6. **Use semantic versioning** (MAJOR.MINOR.PATCH)
7. **Test on multiple Python versions** before publishing

## Exit Criteria

- Modern pyproject.toml configuration
- Clear dependency specification
- Proper version management
- Tests included and passing
- Build process reproducible
- Publishing pipeline automated
