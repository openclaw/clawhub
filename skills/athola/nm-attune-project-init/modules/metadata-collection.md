# Metadata Collection Module

Collect project metadata from user or infer from environment.

## Required Metadata

### Universal (All Languages)

1. **Project Name**
   - Default: Current directory name
   - Validation: lowercase, hyphens allowed, no spaces
   - Example: `my-awesome-project`

2. **Author Name**
   - Try to infer from git config: `git config user.name`
   - Fallback: Ask user
   - Example: `Alex Thola`

3. **Author Email**
   - Try to infer from git config: `git config user.email`
   - Fallback: Ask user
   - Example: `alex@example.com`

4. **Project Description**
   - Short one-liner
   - Default: "A new [language] project"
   - Example: `A CLI tool for managing tasks`

5. **License Type**
   - Options: MIT, Apache-2.0, GPL-3.0, BSD-3-Clause
   - Default: MIT
   - Example: `MIT`

### Language-Specific

**Python**:
- `python_version`: Default "3.10"
  - Check installed Python: `python3 --version`
  - Options: 3.10, 3.11, 3.12, 3.13

**Rust**:
- `rust_edition`: Default "2021"
  - Options: 2015, 2018, 2021, 2024

**TypeScript**:
- `framework`: React, Vue, Svelte, None
- `package_manager`: npm, pnpm, yarn

## Inference Strategy

```bash
# Try git config first
AUTHOR=$(git config user.name 2>/dev/null || echo "Your Name")
EMAIL=$(git config user.email 2>/dev/null || echo "you@example.com")

# Try to detect Python version
PYTHON_VERSION=$(python3 --version 2>/dev/null | cut -d' ' -f2 | cut -d'.' -f1,2)
```

## Interactive Prompts

If values can't be inferred:

```
Project Metadata
================

Project name [my-project]:
Author name [Your Name]: Alex Thola
Author email [you@example.com]: alex@example.com
Description: A CLI tool for managing tasks
Python version [3.10]: 3.12
License [MIT]:

Continue with these settings? [Y/n]:
```

## Validation

- **Project name**: Must be valid Python module name (or Rust crate, npm package)
  - Convert spaces to hyphens
  - Lowercase only
  - No special characters except hyphen/underscore

- **Email**: Basic format check (contains @)

- **Python version**: Must be supported (>= 3.10)

## Output Variables

Store in dictionary for template rendering:

```python
metadata = {
    "PROJECT_NAME": "my-awesome-project",
    "PROJECT_MODULE": "my_awesome_project",  # Python module name
    "AUTHOR": "Alex Thola",
    "EMAIL": "alex@example.com",
    "PYTHON_VERSION": "3.12",
    "DESCRIPTION": "A CLI tool for managing tasks",
    "LICENSE": "MIT",
    "YEAR": "2026",
}
```

## Examples

### Example 1: Fully Inferred

```bash
# Git config exists, Python version detected
Inferred project metadata:
  Name: awesome-cli (from directory)
  Author: Alex Thola (from git config)
  Email: alex@example.com (from git config)
  Python: 3.12 (detected)
  License: MIT (default)

Accept these settings? [Y/n]: y
```

### Example 2: Interactive

```bash
# No git config, ask user
Project name [awesome-cli]:
Author name: Alex Thola
Author email: alex@example.com
Description: A CLI tool for managing tasks
Python version [3.10]: 3.12
License [MIT]:
```
