---
name: pyproject-patterns
description: pyproject.toml configuration patterns and examples for different package types
parent_skill: python-packaging
estimated_tokens: 350
dependencies: []
---

# pyproject.toml Patterns

Configuration patterns for different Python package types.

## Build Backend Choice

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

**Options:**
- **hatchling**: Modern, fast, minimal config
- **setuptools**: Traditional, widely supported
- **flit**: Simple, pure Python packages
- **poetry-core**: Poetry ecosystem integration

## Package Type Matrix

| Type | Layout | Backend | Use Case |
|------|--------|---------|----------|
| Simple Library | Flat | flit | Pure Python, few deps |
| Complex Library | Source | hatchling | Mixed deps, tests |
| CLI Tool | Source | hatchling | Entry points needed |
| Data Science | Source | setuptools | Heavy deps, compiled |

## Simple Package

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "my-package"
version = "0.1.0"
description = "A simple Python package"
readme = "README.md"
requires-python = ">=3.9"
license = "MIT"
authors = [
    { name = "Your Name", email = "you@example.com" }
]
dependencies = [
    "requests>=2.0.0",
]
```

## CLI Package

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "my-cli"
version = "0.1.0"
description = "A CLI tool"
requires-python = ">=3.9"
dependencies = [
    "click>=8.0.0",
    "rich>=13.0.0",
]

[project.scripts]
my-cli = "my_cli.main:cli"
```

## Development Package

```toml
[project]
name = "my-package"
version = "0.1.0"
dependencies = ["requests>=2.0.0"]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-cov>=4.0.0",
    "ruff>=0.1.0",
    "mypy>=1.0.0",
]
docs = [
    "mkdocs>=1.5.0",
    "mkdocs-material>=9.0.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = ["-v", "--cov=src"]

[tool.ruff]
line-length = 100
target-version = "py39"

[tool.mypy]
python_version = "3.9"
strict = true
```

## Advanced Patterns

### Namespace Packages
```toml
[project]
name = "mycompany-core"

[tool.hatch.build.targets.wheel]
packages = ["src/mycompany"]
```

### Conditional Dependencies
```toml
[project]
dependencies = [
    "requests>=2.0.0",
    "typing-extensions>=4.0; python_version < '3.11'",
]

[project.optional-dependencies]
gpu = ["torch", "cuda-python"]
cpu = ["numpy", "scipy"]
```

### Dynamic Version
```toml
[project]
dynamic = ["version"]

[tool.hatch.version]
path = "src/my_package/__init__.py"
```

```python
# src/my_package/__init__.py
__version__ = "0.1.0"
```

## Anti-Patterns to Avoid

```python
# Don't: Complex setup.py with file reading
setup(
    version=open("version.txt").read(),
    install_requires=open("requirements.txt").readlines(),
)

# Do: Simple pyproject.toml
[project]
version = "0.1.0"
dependencies = ["requests>=2.0.0"]
```
