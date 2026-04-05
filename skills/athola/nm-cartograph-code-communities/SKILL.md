---
name: code-communities
description: |
  Detect architectural clusters in the codebase using community detection on the code knowledge graph. Shows module boundaries, cohesion, and coupling warnings
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/cartograph", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: cartograph
---

> **Night Market Skill** — ported from [claude-night-market/cartograph](https://github.com/athola/claude-night-market/tree/master/plugins/cartograph). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Code Community Detection

Identify architectural clusters and module boundaries
in the codebase.

## Prerequisites

This skill requires the **gauntlet** plugin for graph
data. Discover it:

```bash
GRAPH_QUERY=$(find ~/.claude/plugins -name "graph_query.py" -path "*/gauntlet/*" 2>/dev/null | head -1)
```

**If gauntlet is not installed**: Fall back to directory
structure analysis. Group files by directory and use
import statements to identify module boundaries. Generate
a Mermaid diagram from directory-level relationships.

**If installed but no graph.db**: Tell the user to run
`/gauntlet-graph build`.

## Steps

1. **Run community detection** (requires gauntlet):
   ```bash
   python3 "$GRAPH_QUERY" --action communities
   ```

   **Fallback (no gauntlet)**: Analyze directory structure
   and cross-directory imports:
   ```bash
   # Directory-level grouping
   find . -name "*.py" -not -path "*/node_modules/*" | \
       sed 's|/[^/]*$||' | sort | uniq -c | sort -rn

   # Cross-directory imports (rg preferred, grep fallback)
   if command -v rg &>/dev/null; then
     rg "^from |^import " --type py -l . | \
       xargs -I{} rg "^from \w+ import|^import \w+" {} --no-filename
   else
     grep -rh "^from \|^import " --include="*.py" .
   fi | sort | uniq -c | sort -rn | head -20
   ```
   Group by top-level directories and count cross-directory
   imports to estimate coupling.

2. **Display clusters**:
   ```
   Community         | Nodes | Cohesion | Description
   auth              |    12 |    0.85  | Authentication module
   db                |     8 |    0.92  | Database access layer
   api/handlers      |    15 |    0.71  | API request handlers
   utils             |     6 |    0.45  | Shared utilities
   ```

3. **Show coupling warnings**: If communities have
   >10 cross-boundary edges, highlight them:
   ```
   WARNING: High coupling between 'auth' and 'api/handlers'
   (23 cross-community edges, severity: high)
   ```

4. **Generate Mermaid diagram**:
   ```mermaid
   flowchart TB
     subgraph auth[Auth Module - cohesion 0.85]
       verify_token
       check_permissions
     end
     subgraph db[DB Layer - cohesion 0.92]
       execute_query
       connection_pool
     end
     auth -->|"23 edges"| api
     db -->|"5 edges"| api
   ```

5. **Suggest improvements**:
   - Low cohesion (<0.5): "Consider splitting this
     module into more focused components"
   - High coupling (>20 edges): "Consider introducing
     an interface to reduce direct dependencies"

## Algorithm

Uses the Leiden algorithm (when igraph is available)
with edge-type-specific weights. Falls back to
file-based grouping otherwise.

| Edge Type | Weight |
|-----------|--------|
| CALLS | 1.0 |
| INHERITS | 0.8 |
| IMPLEMENTS | 0.7 |
| IMPORTS_FROM | 0.5 |
| TESTED_BY | 0.4 |
| CONTAINS | 0.3 |
