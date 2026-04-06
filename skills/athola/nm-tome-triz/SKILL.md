---
name: triz
description: |
  Apply TRIZ cross-domain analogical reasoning to find solutions from adjacent fields
version: 1.8.1
triggers:
  - triz
  - cross-domain
  - innovation
  - analogy
  - altshuller
  - conventional approaches stall
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/tome", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: tome
---

> **Night Market Skill** — ported from [claude-night-market/tome](https://github.com/athola/claude-night-market/tree/master/plugins/tome). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# TRIZ Cross-Domain Analysis

## When To Use

- Stuck on a problem and need perspectives from other domains
- Exploring cross-domain analogies for inventive solutions

## When NOT To Use

- Standard code search or literature review (use other
  tome channels)
- Problems with obvious, well-known solutions

Apply Altshuller's Theory of Inventive Problem Solving
to find solutions from adjacent fields.

## Depth Levels

| Depth | Fields | Analysis |
|-------|--------|----------|
| light | 1 | Contradiction only |
| medium | 2 | Contradiction + field mapping |
| deep | 3 | Full matrix + principles |
| maximum | 5 | Distant fields + full TRIZ |

## Workflow

1. Abstract the problem into TRIZ formulation
2. Identify technical contradiction
3. Map to adjacent fields using Semantic Scholar's
   field taxonomy
4. Search for solved analogues in those fields
5. Build bridge mappings with rationale

## Field Mapping Strategy

- Software architecture: civil engineering, biology
- Data structures: logistics, materials science
- Algorithms: operations research, genetics
- Security: military strategy, immunology
- Financial: game theory, ecology
