---
name: precommit-setup
description: |
  Configure pre-commit hooks for linting, type checking, formatting, and testing to enforce quality gates on every commit
version: 1.8.1
triggers:
  - pre-commit
  - quality-gates
  - linting
  - type-checking
  - testing
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When To Use](#when-to-use)
- [Philosophy: Three-Layer Defense](#philosophy:-three-layer-defense)
- [Standard Hooks (Layer 1)](#standard-hooks-(layer-1))
- [Python Projects](#python-projects)
- [Basic Quality Checks](#basic-quality-checks)
- [Configuration](#configuration)
- [Rust Projects](#rust-projects)
- [TypeScript Projects](#typescript-projects)
- [Component-Specific Checks (Layer 2)](#component-specific-checks-(layer-2))
- [Python Monorepo/Plugin Architecture](#python-monorepo-plugin-architecture)
- [1. Lint Changed Components (`scripts/run-component-lint.sh`)](#1-lint-changed-components-(scripts-run-component-lintsh))
- [2. Type Check Changed Components (`scripts/run-component-typecheck.sh`)](#2-type-check-changed-components-(scripts-run-component-typechecksh))
- [3. Test Changed Components (`scripts/run-component-tests.sh`)](#3-test-changed-components-(scripts-run-component-testssh))
- [Add to Pre-commit Configuration](#add-to-pre-commit-configuration)
- [Validation Hooks (Layer 3)](#validation-hooks-(layer-3))
- [Example: Plugin Structure Validation](#example:-plugin-structure-validation)
- [Workflow](#workflow)
- [1. Create Configuration Files](#1-create-configuration-files)
- [2. Configure Python Type Checking](#2-configure-python-type-checking)
- [3. Configure Testing](#3-configure-testing)
- [4. Install and Test Hooks](#4-install-and-test-hooks)
- [5. Create Manual Quality Scripts](#5-create-manual-quality-scripts)
- [`scripts/check-all-quality.sh`](#scripts-check-all-qualitysh)
- [Hook Execution Order](#hook-execution-order)
- [Performance Optimization](#performance-optimization)
- [Typical Timings](#typical-timings)
- [Optimization Strategies](#optimization-strategies)
- [Hook Configuration](#hook-configuration)
- [Skip Specific Hooks](#skip-specific-hooks)
- [Custom Hooks](#custom-hooks)
- [CI Integration](#ci-integration)
- [Troubleshooting](#troubleshooting)
- [Hooks Too Slow](#hooks-too-slow)
- [Cache Issues](#cache-issues)
- [Hook Failures](#hook-failures)
- [Import Errors in Tests](#import-errors-in-tests)
- [Type Checking Errors](#type-checking-errors)
- [Best Practices](#best-practices)
- [For New Projects](#for-new-projects)
- [For Existing Projects](#for-existing-projects)
- [For Monorepos/Plugin Architectures](#for-monorepos-plugin-architectures)
- [Complete Example: Python Monorepo](#complete-example:-python-monorepo)
- [Related Skills](#related-skills)
- [See Also](#see-also)


# Pre-commit Setup Skill

Configure a detailed three-layer pre-commit quality system that enforces linting, type checking, and testing before commits.

## When To Use

- Setting up new project with code quality enforcement
- Adding pre-commit hooks to existing project
- Upgrading from basic linting to a full quality system
- Setting up monorepo/plugin architecture with per-component quality checks
- Updating pre-commit hook versions

## When NOT To Use

- Pre-commit hooks already configured and working optimally
- Project doesn't use git version control
- Team explicitly avoids pre-commit hooks for workflow reasons
- Use `/attune:upgrade-project` instead for updating existing configurations

## Philosophy: Three-Layer Defense

This skill implements a technical quality system based on three distinct layers. Layer 1 consists of fast global checks that perform quick linting and type checking on all files in approximately 50 to 200 milliseconds. Layer 2 focuses on component-specific checks, running detailed linting, type checking, and testing for changed components only, which typically takes between 10 and 30 seconds. Finally, Layer 3 uses validation hooks for structure verification, security scanning, and custom project checks. This multi-layered approach verifies that new code is automatically checked before commit, which prevents technical debt from entering the repository.

## Standard Hooks (Layer 1)

### Python Projects

#### Basic Quality Checks
1. **pre-commit-hooks** - File validation (trailing whitespace, EOF, YAML/TOML/JSON syntax)
2. **ruff** - Ultra-fast linting and formatting (~50ms)
3. **ruff-format** - Code formatting
4. **mypy** - Static type checking (~200ms)
5. **bandit** - Security scanning

#### Configuration

\`\`\`yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v6.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-toml
      - id: check-json

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.14.2
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.13.0
    hooks:
      - id: mypy
        args: [--ignore-missing-imports]

  - repo: https://github.com/PyCQA/bandit
    rev: 1.8.0
    hooks:
      - id: bandit
        args: [-c, pyproject.toml]
\`\`\`

### Rust Projects

1. **rustfmt** - Code formatting
2. **clippy** - Linting
3. **cargo-check** - Compilation check

### TypeScript Projects

1. **eslint** - Linting
2. **prettier** - Code formatting
3. **tsc** - Type checking

## Component-Specific Checks (Layer 2)

For monorepos, plugin architectures, or projects with multiple components, add per-component quality checks.

### Python Monorepo/Plugin Architecture

Create quality check scripts:

#### 1. Lint Changed Components (`scripts/run-component-lint.sh`)

\`\`\`bash
#!/bin/bash
# Lint only changed components based on staged files

set -euo pipefail

# Detect changed components from staged files
CHANGED_COMPONENTS=\$(git diff --cached --name-only | grep -E '^(plugins|components)/' | cut -d/ -f2 | sort -u) || true

if [ -z "\$CHANGED_COMPONENTS" ]; then
    echo "No components changed"
    exit 0
fi

echo "Linting changed components: \$CHANGED_COMPONENTS"

FAILED=()

for component in \$CHANGED_COMPONENTS; do
    if [ -d "plugins/\$component" ]; then
        echo "Linting \$component..."
        # Capture exit code to properly propagate failures
        local exit_code=0
        if [ -f "plugins/\$component/Makefile" ] && grep -q "^lint:" "plugins/\$component/Makefile"; then
            (cd "plugins/\$component" && make lint) || exit_code=\$?
        else
            (cd "plugins/\$component" && uv run ruff check .) || exit_code=\$?
        fi
        if [ "\$exit_code" -ne 0 ]; then
            FAILED+=("\$component")
        fi
    fi
done

if [ \${#FAILED[@]} -gt 0 ]; then
    echo "Lint failed for: \${FAILED[*]}"
    exit 1
fi
\`\`\`

#### 2. Type Check Changed Components (`scripts/run-component-typecheck.sh`)

\`\`\`bash
#!/bin/bash
# Type check only changed components

set -euo pipefail

CHANGED_COMPONENTS=\$(git diff --cached --name-only | grep -E '^(plugins|components)/' | cut -d/ -f2 | sort -u) || true

if [ -z "\$CHANGED_COMPONENTS" ]; then
    exit 0
fi

echo "Type checking changed components: \$CHANGED_COMPONENTS"

FAILED=()

for component in \$CHANGED_COMPONENTS; do
    if [ -d "plugins/\$component" ]; then
        echo "Type checking \$component..."
        # Capture output and exit code separately to properly propagate failures
        local output
        local exit_code=0
        if [ -f "plugins/\$component/Makefile" ] && grep -q "^typecheck:" "plugins/\$component/Makefile"; then
            output=\$(cd "plugins/\$component" && make typecheck 2>&1) || exit_code=\$?
        else
            output=\$(cd "plugins/\$component" && uv run mypy src/ 2>&1) || exit_code=\$?
        fi
        # Display output (filter make noise)
        echo "\$output" | grep -v "^make\[" || true
        if [ "\$exit_code" -ne 0 ]; then
            FAILED+=("\$component")
        fi
    fi
done

if [ \${#FAILED[@]} -gt 0 ]; then
    echo "Type check failed for: \${FAILED[*]}"
    exit 1
fi
\`\`\`

#### 3. Test Changed Components (`scripts/run-component-tests.sh`)

\`\`\`bash
#!/bin/bash
# Test only changed components

set -euo pipefail

CHANGED_COMPONENTS=\$(git diff --cached --name-only | grep -E '^(plugins|components)/' | cut -d/ -f2 | sort -u) || true

if [ -z "\$CHANGED_COMPONENTS" ]; then
    exit 0
fi

echo "Testing changed components: \$CHANGED_COMPONENTS"

FAILED=()

for component in \$CHANGED_COMPONENTS; do
    if [ -d "plugins/\$component" ]; then
        echo "Testing \$component..."
        # Capture exit code to properly propagate failures
        local exit_code=0
        if [ -f "plugins/\$component/Makefile" ] && grep -q "^test:" "plugins/\$component/Makefile"; then
            (cd "plugins/\$component" && make test) || exit_code=\$?
        else
            (cd "plugins/\$component" && uv run pytest tests/) || exit_code=\$?
        fi
        if [ "\$exit_code" -ne 0 ]; then
            FAILED+=("\$component")
        fi
    fi
done

if [ \${#FAILED[@]} -gt 0 ]; then
    echo "Tests failed for: \${FAILED[*]}"
    exit 1
fi
\`\`\`

### Add to Pre-commit Configuration

\`\`\`yaml
# .pre-commit-config.yaml (continued)

  # Layer 2: Component-Specific Quality Checks
  - repo: local
    hooks:
      - id: run-component-lint
        name: Lint Changed Components
        entry: ./scripts/run-component-lint.sh
        language: system
        pass_filenames: false
        files: ^(plugins|components)/.*\\.py\$

      - id: run-component-typecheck
        name: Type Check Changed Components
        entry: ./scripts/run-component-typecheck.sh
        language: system
        pass_filenames: false
        files: ^(plugins|components)/.*\\.py\$

      - id: run-component-tests
        name: Test Changed Components
        entry: ./scripts/run-component-tests.sh
        language: system
        pass_filenames: false
        files: ^(plugins|components)/.*\\.(py|md)\$
\`\`\`

## Validation Hooks (Layer 3)

Add custom validation hooks for project-specific requirements.

### Example: Plugin Structure Validation

\`\`\`yaml
  # Layer 3: Validation Hooks
  - repo: local
    hooks:
      - id: validate-plugin-structure
        name: Validate Plugin Structure
        entry: python3 scripts/validate_plugins.py
        language: system
        pass_filenames: false
        files: ^plugins/.*\$
\`\`\`

## Workflow

### 1. Create Configuration Files

\`\`\`bash
# Create .pre-commit-config.yaml
python3 plugins/attune/scripts/attune_init.py \\
  --lang python \\
  --name my-project \\
  --path .

# Create quality check scripts (for monorepos)
mkdir -p scripts
chmod +x scripts/run-component-*.sh
\`\`\`

### 2. Configure Python Type Checking

Create `pyproject.toml` with strict type checking:

\`\`\`toml
[tool.mypy]
python_version = "3.12"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
strict = true

# Per-component configuration
[[tool.mypy.overrides]]
module = "plugins.*"
strict = true
\`\`\`

### 3. Configure Testing

\`\`\`toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
addopts = [
    "-v",                    # Verbose output
    "--strict-markers",      # Strict marker enforcement
    "--cov=src",             # Coverage for src/
    "--cov-report=term",     # Terminal coverage report
]

markers = [
    "slow: marks tests as slow (deselect with '-m \\"not slow\\"')",
    "integration: marks tests as integration tests",
]
\`\`\`

### 4. Install and Test Hooks

\`\`\`bash
# Install pre-commit tool
uv sync --extra dev

# Install git hooks
uv run pre-commit install

# Test on all files (first time)
uv run pre-commit run --all-files

# Normal usage - test on staged files
git add .
git commit -m "feat: add feature"
# Hooks run automatically
\`\`\`

### 5. Create Manual Quality Scripts

For full quality checks (CI/CD, monthly audits):

#### `scripts/check-all-quality.sh`

\`\`\`bash
#!/bin/bash
# Full quality check for all components

set -e

echo "=== Running Full Quality Checks ==="

# Lint all components
./scripts/run-component-lint.sh --all

# Type check all components
./scripts/run-component-typecheck.sh --all

# Test all components
./scripts/run-component-tests.sh --all

echo "=== All Quality Checks Passed ==="
\`\`\`

## Hook Execution Order

Pre-commit hooks run in this order:

\`\`\`
1. File Validation (whitespace, EOF, YAML/TOML/JSON syntax)
2. Security Scanning (bandit)
3. Global Linting (ruff - all files)
4. Global Type Checking (mypy - all files)
5. Component Linting (changed components only)
6. Component Type Checking (changed components only)
7. Component Tests (changed components only)
8. Custom Validation (structure, patterns, etc.)
\`\`\`

All must pass for commit to succeed.

## Performance Optimization

### Typical Timings

| Check | Single Component | Multiple Components | All Components |
|-------|------------------|---------------------|----------------|
| Global Ruff | ~50ms | ~200ms | ~500ms |
| Global Mypy | ~200ms | ~500ms | ~1s |
| Component Lint | ~2-5s | ~4-10s | ~30-60s |
| Component Typecheck | ~3-8s | ~6-16s | ~60-120s |
| Component Tests | ~5-15s | ~10-30s | ~120-180s |
| **Total** | **~10-30s** | **~20-60s** | **~2-5min** |

### Optimization Strategies

1. **Only test changed components** - Default behavior
2. **Parallel execution** - Hooks run concurrently when possible
3. **Caching** - Dependencies cached by uv
4. **Incremental mypy** - Use `--incremental` flag

## Hook Configuration

### Skip Specific Hooks

\`\`\`bash
# Skip specific hook for one commit
SKIP=run-component-tests git commit -m "WIP: tests in progress"

# Skip component checks but keep global checks
SKIP=run-component-lint,run-component-typecheck,run-component-tests git commit -m "WIP"

# Skip all hooks (DANGEROUS - use only for emergencies)
git commit --no-verify -m "Emergency fix"
\`\`\`

### Custom Hooks

Add project-specific hooks:

\`\`\`yaml
  - repo: local
    hooks:
      - id: check-architecture
        name: Validate Architecture Decisions
        entry: python3 scripts/check_architecture.py
        language: system
        pass_filenames: false
        files: ^(plugins|src)/.*\\.py\$

      - id: check-coverage
        name: Verify Test Coverage
        entry: python3 scripts/check_coverage.py
        language: system
        pass_filenames: false
        files: ^(plugins|src)/.*\\.py\$
\`\`\`

## CI Integration

Verify CI runs the same detailed checks:

\`\`\`yaml
# .github/workflows/quality.yml
name: Code Quality

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install uv
        run: pip install uv

      - name: Install dependencies
        run: uv sync

      - name: Run Comprehensive Quality Checks
        run: ./scripts/check-all-quality.sh

      - name: Upload Coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage.xml
\`\`\`

## Troubleshooting

### Hooks Too Slow

**Solution**: Only changed components are checked by default. For even faster commits:

\`\`\`bash
# Skip tests during development
SKIP=run-component-tests git commit -m "WIP: feature development"

# Run tests manually when ready
./scripts/run-component-tests.sh --changed
\`\`\`

### Cache Issues

\`\`\`bash
# Clear pre-commit cache
uv run pre-commit clean

# Clear component caches
find . -name "__pycache__" -type d -exec rm -rf {} +
find . -name ".pytest_cache" -type d -exec rm -rf {} +
find . -name ".mypy_cache" -type d -exec rm -rf {} +
\`\`\`

### Hook Failures

\`\`\`bash
# See detailed output
uv run pre-commit run --verbose --all-files

# Run specific component checks manually
cd plugins/my-component
make lint
make typecheck
make test
\`\`\`

### Import Errors in Tests

\`\`\`toml
# Ensure PYTHONPATH is set in pyproject.toml
[tool.pytest.ini_options]
pythonpath = ["src"]
\`\`\`

### Type Checking Errors

\`\`\`toml
# Use per-module overrides for gradual typing
[[tool.mypy.overrides]]
module = "legacy_module.*"
disallow_untyped_defs = false
\`\`\`

## Best Practices

### For New Projects
Start with strict settings from the beginning, as they are easier to maintain over time. We recommend configuring type checking with `strict = true` in your `pyproject.toml` and setting up testing early by including pytest in your pre-commit hooks. If you must skip any hooks, always document the reason for the exception.

### For Existing Projects
When adding hooks to an existing codebase, use a gradual adoption strategy. Start with global checks and add component-specific checks later as you resolve legacy issues. Fix identified quality problems progressively and create a baseline to document the current state for tracking improvements. Use the `--no-verify` flag sparingly and only for true emergencies.

### For Monorepos and Plugin Architectures
Standardize your development targets by using per-component Makefiles for linting, type checking, and testing. Centralize common settings in a root `pyproject.toml` while allowing for per-component overrides. Automate the detection of changed components to keep commit times fast, and use a progressive disclosure approach to show summaries first and detailed errors only on failure.

## Complete Example: Python Monorepo

\`\`\`yaml
# .pre-commit-config.yaml
repos:
  # Layer 1: Fast Global Checks
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v6.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-toml
      - id: check-json

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.14.2
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.13.0
    hooks:
      - id: mypy
        args: [--ignore-missing-imports]

  - repo: https://github.com/PyCQA/bandit
    rev: 1.8.0
    hooks:
      - id: bandit
        args: [-c, pyproject.toml]

  # Layer 2: Component-Specific Checks
  - repo: local
    hooks:
      - id: run-component-lint
        name: Lint Changed Components
        entry: ./scripts/run-component-lint.sh
        language: system
        pass_filenames: false
        files: ^plugins/.*\\.py\$

      - id: run-component-typecheck
        name: Type Check Changed Components
        entry: ./scripts/run-component-typecheck.sh
        language: system
        pass_filenames: false
        files: ^plugins/.*\\.py\$

      - id: run-component-tests
        name: Test Changed Components
        entry: ./scripts/run-component-tests.sh
        language: system
        pass_filenames: false
        files: ^plugins/.*\\.(py|md)\$

  # Layer 3: Validation Hooks
  - repo: local
    hooks:
      - id: validate-plugin-structure
        name: Validate Plugin Structure
        entry: python3 scripts/validate_plugins.py
        language: system
        pass_filenames: false
        files: ^plugins/.*\$
\`\`\`

## Related Skills

- `Skill(attune:project-init)` - Full project initialization
- `Skill(attune:workflow-setup)` - GitHub Actions setup
- `Skill(attune:makefile-generation)` - Generate component Makefiles
- `Skill(pensive:shell-review)` - Audit shell scripts for exit code and safety issues

## See Also

- **Quality Gates** - Three-layer validation: pre-commit hooks (formatting, linting), CI checks (tests, coverage), and PR review gates (code quality, security)
- **Testing Guide** - Run `make test` for unit tests, `make lint` for static analysis, `make format` for auto-formatting. Target 85%+ coverage.
