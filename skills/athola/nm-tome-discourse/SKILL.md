---
name: discourse
description: |
  >- Scan community discussion channels (HN, Lobsters, Reddit, tech blogs) for experience reports and opinions on a topic
version: 1.8.1
triggers:
  - hackernews
  - reddit
  - lobsters
  - blogs
  - discourse
  - the user wants community perspectives on a technology or approach
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/tome", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: tome
---

> **Night Market Skill** — ported from [claude-night-market/tome](https://github.com/athola/claude-night-market/tree/master/plugins/tome). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Discourse Search

## When To Use

- Gathering community opinions on a technology or approach
- Finding experience reports from HN, Reddit, or Lobsters

## When NOT To Use

- Academic research (use `/tome:papers`)
- Code examples (use `/tome:code-search`)

Scan community channels for discussions on a topic.

## Channels

- **Hacker News**: Algolia API at hn.algolia.com
- **Lobsters**: WebSearch with site:lobste.rs
- **Reddit**: JSON API (append .json to URLs)
- **Tech blogs**: WebSearch targeting curated domains

## Workflow

1. Build search URLs/queries per channel using
   `tome.channels.discourse.*` functions
2. Execute via WebFetch (APIs) or WebSearch (fallback)
3. Parse responses into Finding objects
4. Merge across sources with source attribution
