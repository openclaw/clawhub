---
name: workflow-setup
description: |
  Configure GitHub Actions CI/CD workflows for automated testing, linting, and deployment pipelines
version: 1.8.1
triggers:
  - github-actions
  - ci-cd
  - workflows
  - automation
  - testing
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When To Use](#when-to-use)
- [Standard Workflows](#standard-workflows)
- [Python Workflows](#python-workflows)
- [Rust Workflows](#rust-workflows)
- [TypeScript Workflows](#typescript-workflows)
- [Workflow](#workflow)
- [1. Check Existing Workflows](#1-check-existing-workflows)
- [2. Identify Missing Workflows](#2-identify-missing-workflows)
- [3. Render Workflow Templates](#3-render-workflow-templates)
- [4. Validate Workflows](#4-validate-workflows)
- [Workflow Best Practices](#workflow-best-practices)
- [Use Latest Action Versions](#use-latest-action-versions)
- [Matrix Testing (Python)](#matrix-testing-python)
- [Caching Dependencies](#caching-dependencies)
- [Updating Workflows](#updating-workflows)
- [Related Skills](#related-skills)


# Workflow Setup Skill

Set up GitHub Actions workflows for continuous integration and deployment.

## When To Use

- Need CI/CD for a new project
- Adding missing workflows to existing project
- Updating workflow versions to latest
- Automating testing and quality checks
- Setting up deployment pipelines

## When NOT To Use

- GitHub Actions workflows already configured and current
- Project uses different CI platform (GitLab CI, CircleCI, etc.)
- Not hosted on GitHub
- Use `/attune:upgrade-project` instead for updating existing workflows

## Standard Workflows

### Python Workflows

1. **test.yml** - Run pytest on push/PR
2. **lint.yml** - Run ruff linting
3. **typecheck.yml** - Run mypy type checking
4. **publish.yml** - Publish to PyPI on release

### Rust Workflows

1. **ci.yml** - Combined test/lint/check workflow
2. **release.yml** - Build and publish releases

### TypeScript Workflows

1. **test.yml** - Run Jest tests
2. **lint.yml** - Run ESLint
3. **build.yml** - Build for production
4. **deploy.yml** - Deploy to hosting (Vercel, Netlify, etc.)

## Workflow

### 1. Check Existing Workflows

```bash
ls -la .github/workflows/
```
**Verification:** Run the command with `--help` flag to verify availability.

### 2. Identify Missing Workflows

```python
from project_detector import ProjectDetector

detector = ProjectDetector(Path.cwd())
language = detector.detect_language()

required_workflows = {
    "python": ["test.yml", "lint.yml", "typecheck.yml"],
    "rust": ["ci.yml"],
    "typescript": ["test.yml", "lint.yml", "build.yml"],
}

missing = detector.get_missing_configurations(language)
```
**Verification:** Run `pytest -v` to verify tests pass.

### 3. Render Workflow Templates

```python
workflows_dir = Path(".github/workflows")
workflows_dir.mkdir(parents=True, exist_ok=True)

for workflow in required_workflows[language]:
    template = templates_dir / language / "workflows" / f"{workflow}.template"
    output = workflows_dir / workflow

    engine.render_file(template, output)
    print(f"✓ Created: {output}")
```
**Verification:** Run the command with `--help` flag to verify availability.

### 4. Validate Workflows

```bash
# Syntax check (requires act or gh CLI)
gh workflow list

# Or manually check YAML syntax
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"
```
**Verification:** Run `pytest -v` to verify tests pass.

## Workflow Best Practices

### Use Latest Action Versions

```yaml
# Good - pinned to major version
- uses: actions/checkout@v4
- uses: actions/setup-python@v5

# Avoid - unpinned or outdated
- uses: actions/checkout@v2
- uses: actions/setup-python@latest
```
**Verification:** Run `pytest -v` to verify tests pass.

### Matrix Testing (Python)

```yaml
strategy:
  matrix:
    python-version: ["3.10", "3.11", "3.12"]
    os: [ubuntu-latest, macos-latest, windows-latest]
```
**Verification:** Run `pytest -v` to verify tests pass.

### Caching Dependencies

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: '3.10'
    cache: 'pip'  # Cache pip dependencies
```
**Verification:** Run `python --version` to verify Python environment.

### Shell Script Safety in Workflows

When writing inline shell scripts in workflows, ensure proper exit code handling:

```yaml
# BAD - pipeline masks exit code
- run: |
    make typecheck 2>&1 | grep -v "^make\["
    echo "Typecheck passed"  # Runs even if make failed!

# GOOD - use pipefail
- run: |
    set -eo pipefail
    make typecheck 2>&1 | grep -v "^make\["

# GOOD - capture exit code explicitly
- run: |
    output=$(make typecheck 2>&1) || exit_code=$?
    echo "$output" | grep -v "^make\[" || true
    exit ${exit_code:-0}
```

For complex wrapper scripts, run `/pensive:shell-review` before integrating.

## Updating Workflows

To update workflows to latest versions:

```bash
/attune:upgrade-project --component workflows
```
**Verification:** Run the command with `--help` flag to verify availability.

## Related Skills

- `Skill(attune:project-init)` - Full project initialization
- `Skill(sanctum:pr-prep)` - PR preparation with CI checks
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
