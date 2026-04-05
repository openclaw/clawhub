---
name: curate
description: |
  Add or edit knowledge annotations. Capture tribal knowledge, business context, and rationale that cannot be inferred from code
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: gauntlet
---

> **Night Market Skill** — ported from [claude-night-market/gauntlet](https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Curate Knowledge

Add developer-authored annotations to the knowledge base.

## Steps

1. Identify the module to annotate
2. Ask for the concept (key insight or rule)
3. Ask for the why (rationale, history, context)
4. Generate YAML annotation file
5. Save to `.gauntlet/annotations/<slug>.yaml`
6. Confirm saved and will be included in future challenges
