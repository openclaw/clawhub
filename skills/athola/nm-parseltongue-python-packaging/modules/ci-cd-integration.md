---
name: ci-cd-integration
description: GitHub Actions workflows and automated publishing pipelines
parent_skill: python-packaging
estimated_tokens: 150
dependencies: []
---

# CI/CD Integration

Automated testing, building, and publishing workflows.

## GitHub Actions Publishing

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv build
      - run: uv publish
        env:
          UV_PUBLISH_TOKEN: ${{ secrets.PYPI_TOKEN }}
```

## Testing Workflow

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.9", "3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv sync --all-extras
      - run: uv run pytest
```

## Complete CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  release:
    types: [published]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.9", "3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv sync --all-extras
      - run: uv run pytest --cov
      - run: uv run ruff check
      - run: uv run mypy src

  publish:
    if: github.event_name == 'release'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv build
      - run: uv publish
        env:
          UV_PUBLISH_TOKEN: ${{ secrets.PYPI_TOKEN }}
```

## Best Practices

1. **Test before publish** - Always run tests in CI before publishing
2. **Matrix testing** - Test on multiple Python versions
3. **Use trusted actions** - Official actions from astral-sh, actions org
4. **Secure tokens** - Store PyPI tokens as GitHub secrets
5. **Version tags** - Trigger releases from git tags
6. **Test on TestPyPI** - Verify packages before production publish
