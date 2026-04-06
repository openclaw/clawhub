---
name: blast-radius
description: |
  Analyze the blast radius of code changes with risk scoring. Shows affected nodes, untested functions, and review priorities using the code knowledge graph
version: 1.8.1
triggers:
  - code-review
  - impact-analysis
  - risk-scoring
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Blast Radius Analysis

Analyze the impact of current code changes using the
code knowledge graph.

## Prerequisites

This skill requires the **gauntlet** plugin for graph
data. Check if it's available:

```bash
GRAPH_QUERY=$(find ~/.claude/plugins -name "graph_query.py" -path "*/gauntlet/*" 2>/dev/null | head -1)
```

**If gauntlet is not installed** (GRAPH_QUERY is empty):
Fall back to a manual impact analysis using `git diff`
and `grep` to trace imports and call sites. Skip graph
steps and go directly to step 3 (manual mode).

**If gauntlet is installed but no graph.db exists**:
Tell the user: "Run `/gauntlet-graph build` first."

## Steps

1. **Show current changes**: Run `git diff --stat` to
   show the user what files changed.

2. **Run impact analysis** (requires gauntlet):
   ```bash
   python3 "$GRAPH_QUERY" \
       --action impact --base-ref HEAD --depth 2
   ```

   **Fallback (no gauntlet)**: Trace callers of changed
   functions with rg (or grep):
   ```bash
   # Prefer rg for speed; fall back to grep
   if command -v rg &>/dev/null; then
     git diff --name-only HEAD | while read f; do
       rg -l "$(basename $f .py)" --type py . 2>/dev/null
     done | sort -u
   else
     git diff --name-only HEAD | while read f; do
       grep -rl "$(basename $f .py)" --include="*.py" . 2>/dev/null
     done | sort -u
   fi
   ```

3. **Display results in priority order**:

   Format the output as a table:
   ```
   Risk  | Node                    | File          | Reason
   0.85  | auth.py::verify_token   | auth.py:45    | untested, security
   0.62  | db.py::execute_query    | db.py:112     | high fan-in
   0.41  | api.py::handle_request  | api.py:78     | flow participant
   ```

4. **Highlight untested functions**: List any affected
   functions that lack test coverage (no TESTED_BY edge).

5. **Show overall risk**: Display the overall risk level
   (low/medium/high) based on the maximum risk score.

6. **Suggest actions**:
   - For high-risk nodes: "Consider adding tests before
     merging"
   - For security-sensitive nodes: "Review authentication
     and authorization logic carefully"
   - For high-fan-in nodes: "Changes here affect many
     callers; verify backward compatibility"

## Risk Scoring Model

Five weighted factors (sum capped at 1.0):

| Factor | Weight | Meaning |
|--------|--------|---------|
| Test gap | 0.30 | No test coverage |
| Security | 0.20 | Auth/crypto/SQL keywords |
| Flow participation | 0.25 | Part of execution flows |
| Cross-community | 0.15 | Called from other modules |
| Caller count | 0.10 | High fan-in function |
