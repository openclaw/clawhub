# Pytest Configuration Modules

This directory contains modular components of the `leyline:pytest-config` skill, organized following the hub-and-spoke pattern.

## Module Organization

### [conftest-patterns.md](conftest-patterns.md) (159 lines, ~220 tokens)
Conftest.py templates and fixture patterns:
- Project-specific conftest.py template
- Sample data fixtures (skill frontmatter, plugin.json)
- Standard test markers (unit, integration, slow, e2e)
- Domain-specific markers (git, performance, asyncio)
- Test directory structure

**Reusable by**: Any plugin's `tests/conftest.py` setup

### [git-testing-fixtures.md](git-testing-fixtures.md) (87 lines, ~140 tokens)
GitRepository helper class for testing git workflows:
- GitRepository class implementation
- Methods: init, config, add_file, commit
- temp_git_repo fixture
- Usage examples

**Reusable by**: sanctum plugin, git workflow testing, commit/PR testing

### [mock-fixtures.md](mock-fixtures.md) (79 lines, ~95 tokens)
Mock tool fixtures for Claude Code tools:
- mock_bash_tool fixture
- mock_todo_tool fixture
- Usage examples for testing tool interactions

**Reusable by**: Skills testing tool interactions, agent behavior testing

### [ci-integration.md](ci-integration.md) (109 lines, ~120 tokens)
CI/CD integration patterns:
- Common pytest command patterns
- GitHub Actions workflow templates
- Multi-Python version testing
- Makefile integration

**Reusable by**: `.github/workflows/test.yml`, CI/CD pipeline setup

## Usage Pattern

The main SKILL.md (91 lines, ~200 tokens) serves as a hub that:
1. Provides the most frequently reused pyproject.toml configuration
2. Keeps the Quick Start section for immediate use
3. Links to detailed modules for specific patterns
4. Documents integration with other skills

**Total reduction**: From 356 lines (750 tokens) to 91 lines (200 tokens) in main hub - 74% reduction in hub size while preserving all content.

## When to Load Modules

- **conftest-patterns.md** - When setting up test infrastructure or configuring fixtures
- **git-testing-fixtures.md** - When testing git-based workflows (commits, PRs, branches)
- **mock-fixtures.md** - When testing skills that use Claude Code tools
- **ci-integration.md** - When setting up GitHub Actions or CI/CD pipelines
