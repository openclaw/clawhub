---
name: graph-search
description: |
  Search the code knowledge graph by function, class, or type name using FTS5 full-text search with query-aware kind boosting
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: gauntlet
---

> **Night Market Skill** — ported from [claude-night-market/gauntlet](https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Search Code Knowledge Graph

Search `.gauntlet/graph.db` for code entities by name.

## Steps

1. **Accept query**: Get the search term from the user.

2. **Run the query script**:
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/graph_query.py \
       --action search --query "<term>" --limit 20
   ```

   Optional filters:
   - `--kind Function` to search only functions
   - `--kind Class` to search only classes

3. **Display results**: Show qualified name, file path,
   line numbers, and relevance score for each match.

4. **Offer to read**: Ask if the user wants to read the
   top result's source file.

## Query Intelligence

The search engine detects query patterns:

- **PascalCase** (e.g., `UserService`): boosts Class
  and Type results
- **snake_case** (e.g., `get_users`): boosts Function
  results
- **Dotted path** (e.g., `app.models.User`): boosts
  qualified name matches

## Prerequisites

The graph must be built first. If `.gauntlet/graph.db`
does not exist, suggest running the `graph-build` skill.
