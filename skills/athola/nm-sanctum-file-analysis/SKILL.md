---
name: file-analysis
description: |
  Map file structure and organization for downstream review and refactoring workflows
version: 1.8.1
triggers:
  - files
  - structure
  - analysis
  - codebase
  - exploration
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:shared", "night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# File Analysis

## When To Use
- Before architecture reviews to understand module boundaries and file organization.
- When exploring unfamiliar codebases to map structure before making changes.
- As input to scope estimation for refactoring or migration work.

## When NOT To Use

- General code exploration - use the Explore agent
- Searching for specific patterns - use Grep directly

## Required TodoWrite Items
1. `file-analysis:root-identified`
2. `file-analysis:structure-mapped`
3. `file-analysis:patterns-detected`
4. `file-analysis:hotspots-noted`

Mark each item as complete as you finish the corresponding step.

## Step 1: Identify Root (`file-analysis:root-identified`)
- Confirm the analysis root directory with `pwd`.
- Note any monorepo boundaries, workspace roots, or subproject paths.
- Capture the project type (language, framework) from manifest files (`package.json`, `Cargo.toml`, `pyproject.toml`, etc.).

## Step 2: Map Structure (`file-analysis:structure-mapped`)
- Run `tree -L 2 -d` or `find . -type d -maxdepth 2` to capture the top-level directory layout.
- Identify standard directories: `src/`, `lib/`, `tests/`, `docs/`, `scripts/`, `configs/`.
- Note any non-standard organization patterns that may affect downstream analysis.

## Step 3: Detect Patterns (`file-analysis:patterns-detected`)
- Use `find . -name "*.ext" -not -path "*/.venv/*" -not -path "*/__pycache__/*" -not -path "*/node_modules/*" -not -path "*/.git/*" | wc -l` to count files by extension.
- Identify dominant languages and their file distributions.
- Note configuration files, generated files, and vendored dependencies.
- Run `wc -l $(find . -not -path "*/.venv/*" -not -path "*/__pycache__/*" -not -path "*/node_modules/*" -not -path "*/.git/*" -name "*.py" -o -name "*.rs" | head -20)` to sample file sizes.

## Step 4: Note Hotspots (`file-analysis:hotspots-noted`)
- Identify large files (potential "god objects"): `find . -type f -exec wc -l {} + | sort -rn | head -10`.
- Flag deeply nested directories that may indicate complexity.
- Note files with unusual naming conventions or placement.

## Exit Criteria
- `TodoWrite` items are completed with concrete observations.
- Downstream workflows (architecture review, refactoring) have structural context.
- File counts, directory layout, and hotspots are documented for reference.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
