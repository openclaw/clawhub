---
name: project-init
description: |
  'Interactive project initialization with git setup, workflows, hooks, and build configuration. project setup, initialization, scaffold, bootstrap, new project.'
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Use When](#use-when)
- [Workflow](#workflow)
- [1. Detect or Select Language](#1-detect-or-select-language)
- [2. Collect Project Metadata](#2-collect-project-metadata)
- [3. Review Existing Files](#3-review-existing-files)
- [4. Render and Apply Templates](#4-render-and-apply-templates)
- [5. Initialize Git (if needed)](#5-initialize-git-(if-needed))
- [6. Verify Setup](#6-verify-setup)
- [7. Next Steps](#7-next-steps)
- [Error Handling](#error-handling)
- [Success Criteria](#success-criteria)
- [Examples](#examples)
- [Example 1: New Python Project](#example-1:-new-python-project)


# Project Initialization Skill

Interactive workflow for initializing new software projects with complete development infrastructure.

## Use When

- Starting a new Python, Rust, or TypeScript project
- Updating existing project tooling to current standards
- Need to set up git, GitHub workflows, pre-commit hooks, Makefile
- Want consistent project structure across team
- Converting unstructured project to best practices
- Adding missing configurations to established codebases

## Workflow

### 1. Detect or Select Language

Load `modules/language-detection.md`

- Auto-detect from existing files (pyproject.toml, Cargo.toml, package.json)
- If ambiguous or empty directory, ask user to select
- Validate language is supported (python, rust, typescript)

### 2. Collect Project Metadata

Load `modules/metadata-collection.md`

Gather:
- Project name (default: directory name)
- Author name and email
- Project description
- Language-specific settings:
  - Python: version (default 3.10)
  - Rust: edition (default 2021)
  - TypeScript: framework (React, Vue, etc.)
- License type (MIT, Apache, GPL, etc.)

### 3. Review Existing Files

Check for existing configurations:
```bash
ls -la
```
**Verification:** Run the command with `--help` flag to verify availability.

If files exist (Makefile, .gitignore, etc.):
- Show what would be overwritten
- Ask for confirmation or selective overwrite
- Offer merge mode (preserve custom content)

### 4. Render and Apply Templates

Load `modules/template-rendering.md`

Run initialization script:
```bash
python3 plugins/attune/scripts/attune_init.py \
  --lang {{LANGUAGE}} \
  --name {{PROJECT_NAME}} \
  --author {{AUTHOR}} \
  --email {{EMAIL}} \
  --python-version {{PYTHON_VERSION}} \
  --description {{DESCRIPTION}} \
  --path .
```
**Verification:** Run the command with `--help` flag to verify availability.

### 5. Initialize Git (if needed)

```bash
# Check if git is initialized
if [ ! -d .git ]; then
  git init
  echo "Git repository initialized"
fi
```
**Verification:** Run `git status` to confirm working tree state.

### 6. Verify Setup

Validate setup:
```bash
# Check Makefile targets
make help

# List created files
git status
```
**Verification:** Run `git status` to confirm working tree state.

### 7. Next Steps

Advise user to:
```bash
# Install dependencies and hooks
make dev-setup

# Run tests to verify setup
make test

# See all available commands
make help
```
**Verification:** Run `pytest -v` to verify tests pass.

## Error Handling

- **Language detection fails**: Ask user to specify `--lang`
- **Script not found**: Guide to plugin installation location
- **Permission denied**: Suggest `chmod +x` on scripts
- **Git conflicts**: Offer to stash or commit existing work

## Success Criteria

- All template files created successfully
- No overwrites without user confirmation
- Git repository initialized
- `make help` shows available targets
- `make test` runs without errors (even if no tests yet)

## Examples

### Example 1: New Python Project

```
**Verification:** Run `pytest -v` to verify tests pass.
User: /attune:project-init
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
