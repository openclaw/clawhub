---
name: call-chain
description: |
  Trace execution paths from entry points through the code knowledge graph. Shows call chains with criticality scores and generates Mermaid flowcharts
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/cartograph", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: cartograph
---

> **Night Market Skill** — ported from [claude-night-market/cartograph](https://github.com/athola/claude-night-market/tree/master/plugins/cartograph). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Call Chain Tracing

Trace execution flows through the codebase using the
code knowledge graph.

## Prerequisites

This skill requires the **gauntlet** plugin for graph
data. Discover it:

```bash
GRAPH_QUERY=$(find ~/.claude/plugins -name "graph_query.py" -path "*/gauntlet/*" 2>/dev/null | head -1)
```

**If gauntlet is not installed**: Fall back to static
analysis. Use `grep` to trace function calls and build
a Mermaid diagram manually from import/call patterns.
Skip graph-specific steps.

**If installed but no graph.db**: Tell the user to run
`/gauntlet-graph build`.

## Steps

1. **Accept target**: Get a function name or entry point
   from the user (or trace all entry points).

2. **Run flow tracing** (requires gauntlet):
   ```bash
   python3 "$GRAPH_QUERY" --action flows --depth 15
   ```

   To filter by entry point:
   ```bash
   python3 "$GRAPH_QUERY" --action flows --entry "main"
   ```

   **Fallback (no gauntlet)**: Trace calls with rg (or grep):
   ```bash
   # Prefer rg (ripgrep) for speed; fall back to grep
   if command -v rg &>/dev/null; then
     rg -n "function_name\(" --type py . | head -20
   else
     grep -rn "function_name(" --include="*.py" . | head -20
   fi
   ```
   Build the call tree manually from search results.

3. **Display as indented tree**:
   ```
   main() [criticality: 0.72]
     -> validate_input()
       -> parse_config()
     -> process_data()
       -> db.execute_query()
       -> cache.store()
     -> send_response()
   ```

4. **Generate Mermaid flowchart**:
   ```mermaid
   flowchart LR
     main --> validate_input
     main --> process_data
     main --> send_response
     validate_input --> parse_config
     process_data --> db.execute_query
     process_data --> cache.store
   ```

5. **Show criticality breakdown**:
   - File spread: how many files the flow touches
   - Security sensitivity: auth/crypto code in the path
   - Test coverage gaps: untested nodes in the flow

## Criticality Scoring

| Factor | Weight | Meaning |
|--------|--------|---------|
| File spread | 0.30 | Touches many files |
| Security | 0.25 | Contains auth/crypto code |
| External calls | 0.20 | Unresolved dependencies |
| Test gap | 0.15 | Untested nodes in flow |
| Depth | 0.10 | Deep call chains |
