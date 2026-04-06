---
name: extract
description: |
  Analyze a codebase and build a knowledge base of business logic, architecture, data flow, and engineering patterns. The foundation for gauntlet challenges and agent integration
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: gauntlet
---

> **Night Market Skill** — ported from [claude-night-market/gauntlet](https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Extract Codebase Knowledge

Build or rebuild the `.gauntlet/knowledge.json` knowledge base.

## Steps

1. **Identify target directory**: use the current working directory
   or a user-specified path

2. **Run AST extraction**: invoke the extractor script
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extractor.py <target-dir>
   ```

3. **AI enrichment**: for each extracted entry, enhance the `detail`
   field with natural language explanation of business logic, data
   flow, architectural role, and rationale

4. **Cross-reference**: link related entries across modules by
   matching imports, shared types, and data flow paths

5. **Merge with annotations**: preserve existing curated entries
   in `.gauntlet/annotations/`

6. **Save**: write to `.gauntlet/knowledge.json`

7. **Report**: show summary by category, coverage gaps, difficulty
   distribution

## Category Priority

1. business_logic (weight 7)
2. architecture (weight 6)
3. data_flow (weight 5)
4. api_contract (weight 4)
5. pattern (weight 3)
6. dependency (weight 2)
7. error_handling (weight 1)
