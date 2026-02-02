# Using claude-mem with OpenClaw

This guide explains how to integrate [claude-mem](https://github.com/thedotmack/claude-mem) with OpenClaw to reduce token usage through persistent memory compression.

## Overview

claude-mem is a Claude Code plugin that:
- Captures everything Claude does during coding sessions
- Compresses context with AI
- Injects relevant history into future sessions
- Reduces token usage ~10x via progressive disclosure

When combined with OpenClaw's agent capabilities, this creates a powerful memory system that persists across sessions.

## Installation

### As an OpenClaw Skill

```bash
# Install via ClawHub (when available)
clawhub install claude-mem

# Or manually - creates ~/.claude/plugins/marketplaces/thedotmack/
cd ~/.claude/plugins/marketplaces
git clone https://github.com/thedotmack/claude-mem.git thedotmack
cd thedotmack
npm install
```

> **Note:** The `thedotmack` directory name is the marketplace namespace. The plugin code lives inside it.

### Configuration

Settings at `~/.claude-mem/settings.json`:

```json
{
  "model": "claude-sonnet-4-latest",
  "workerPort": 37777,
  "dataDir": "~/.claude-mem/data",
  "logLevel": "info",
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000
  }
}
```

> **Note:** Replace `claude-sonnet-4-latest` with your preferred model identifier (e.g., `claude-sonnet-4-20250514`).

## How It Works with OpenClaw

### Token Savings Pattern

claude-mem uses a 3-layer search pattern that integrates well with OpenClaw's session management:

```
1. search         → Compact index (~50-100 tokens/result)
2. timeline       → Chronological context around results  
3. get_observations → Full details ONLY for filtered IDs (~500-1000 tokens/result)
```

This is ~10x more efficient than loading full context every time.

### Integration Points

| Component | claude-mem | OpenClaw |
|-----------|------------|----------|
| Memory Storage | SQLite + Chroma | MEMORY.md + memory/*.md |
| Session Context | Lifecycle hooks | Workspace files |
| Search | MCP tools | memory_search |
| Token Optimization | Progressive disclosure | Conversation compaction |

### Complementary Use

1. **claude-mem** handles Claude Code session memory (tool calls, code changes)
2. **OpenClaw** handles conversational memory (MEMORY.md, daily logs)
3. Together they provide comprehensive context without token bloat

## SKILL.md Template

For skill authors who want to package claude-mem for ClawHub:

```markdown
---
name: claude-mem
description: Persistent memory compression for Claude Code. Automatically captures session context, compresses with AI, and injects relevant history into future sessions.
homepage: https://github.com/thedotmack/claude-mem
metadata:
  openclaw:
    emoji: "🧠"  # Emoji supported in SKILL.md frontmatter
    requires:
      bins: ["node", "npm", "claude"]
---

# claude-mem

[Skill documentation here...]
```

## Web Viewer

Access the memory stream at `http://localhost:37777` to:
- View real-time observations
- Browse session history
- Search past context
- Configure settings

## Resources

- [claude-mem GitHub](https://github.com/thedotmack/claude-mem)
- [claude-mem Documentation](https://docs.claude-mem.ai)
- [OpenClaw Documentation](https://docs.openclaw.ai) — Official OpenClaw docs
- [OpenClaw Discord](https://discord.com/invite/clawd) — Community support

## License

claude-mem is AGPL-3.0 licensed. See the [LICENSE](https://github.com/thedotmack/claude-mem/blob/main/LICENSE) for details.
