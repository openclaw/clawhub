---
name: graph-build
description: |
  Build or incrementally update the code knowledge graph for a codebase. Uses Tree-sitter for multi-language AST parsing and stores nodes/edges in SQLite
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: gauntlet
---

> **Night Market Skill** — ported from [claude-night-market/gauntlet](https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Build Code Knowledge Graph

Build or update the `.gauntlet/graph.db` knowledge graph
for the current codebase.

## Steps

1. **Detect target**: Use the current working directory
   or a user-specified path.

2. **Check for existing graph**: If `.gauntlet/graph.db`
   exists, run an incremental update. Otherwise, run a
   full build.

3. **Run the build script**:

   For full build:
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/graph_build.py <dir>
   ```

   For incremental update:
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/graph_build.py <dir> --incremental
   ```

4. **Report results**: Show the JSON output including
   files parsed, nodes created, edges created, and
   duration.

5. **Suggest next steps**: Recommend searching the graph
   or running blast radius analysis.

## When To Use

- At the start of a session to build structural awareness
- After significant code changes to update the graph
- Before running blast radius analysis or flow tracing
- When the user asks about codebase structure

## What Gets Parsed

The graph extracts nodes (File, Class, Function, Type,
Test) and edges (CALLS, IMPORTS_FROM, INHERITS, CONTAINS,
IMPLEMENTS, TESTED_BY) from 20+ languages including
Python, JavaScript, TypeScript, Go, Rust, Java, C/C++,
Ruby, and PHP.

## Storage

- Database: `.gauntlet/graph.db` (SQLite with WAL mode)
- Auto-creates `.gauntlet/.gitignore` to prevent commits
- Incremental updates use SHA-256 hashing to skip
  unchanged files
