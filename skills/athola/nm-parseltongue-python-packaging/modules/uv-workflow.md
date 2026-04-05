---
name: uv-workflow
description: Complete uv package manager workflows for Python project management
parent_skill: python-packaging
estimated_tokens: 250
dependencies: []
---

# uv Workflow

Complete workflows for using uv package manager in Python projects.

## Project Setup

```bash
# Initialize new project
uv init my-project
cd my-project

# Create with specific Python version
uv init --python 3.12 my-project
```

## Dependency Management

```bash
# Add dependencies
uv add requests click

# Add dev dependencies
uv add --dev pytest ruff mypy

# Add optional dependencies group
uv add --optional docs mkdocs

# Remove dependency
uv remove requests

# Sync environment
uv sync
```

## Building and Publishing

```bash
# Build package
uv build

# Publish to TestPyPI
uv publish --publish-url https://test.pypi.org/legacy/

# Publish to PyPI
uv publish
```

## Version Management

```bash
# Update version in pyproject.toml manually, then:
git tag v0.1.1
git push origin v0.1.1
```

## Troubleshooting

### Build Failures
```bash
# Check build isolation
uv build --no-isolation

# Clear build cache
rm -rf build/ dist/
```

### Import Errors
```bash
# Verify package structure
python -c "import my_package"

# Install in development mode
uv pip install -e .
```

### Version Conflicts
```bash
# Check dependency tree
uv tree

# Use specific versions
uv add "requests==2.28.2"
```
