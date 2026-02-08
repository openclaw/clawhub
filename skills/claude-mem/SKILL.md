---
name: claude-mem
description: Persistent memory compression for Claude Code. Automatically captures session context, compresses with AI, and injects relevant history into future sessions. Reduces token usage ~10x via progressive disclosure search pattern.
homepage: https://github.com/thedotmack/claude-mem
metadata:
  openclaw:
    emoji: "🧠"
    requires:
      bins: ["node", "npm", "claude"]
---

# claude-mem

Persistent memory compression system for Claude Code. Captures everything Claude does, compresses it with AI, and injects relevant context back into future sessions.

## Features

- 🧠 **Persistent Memory** - Context survives across sessions
- 📊 **Progressive Disclosure** - Layered retrieval saves ~10x tokens
- 🔍 **Semantic Search** - Query project history with natural language
- 🖥️ **Web Viewer** - Real-time memory stream at http://localhost:37777
- 🔒 **Privacy Control** - Tag-based exclusion from storage

## Install

### Via Claude Code Plugin (Recommended)

```bash
# In Claude Code session:
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
```

Then restart Claude Code.

### Manual Install

```bash
cd ~/.claude/plugins/marketplaces
git clone https://github.com/thedotmack/claude-mem.git thedotmack
cd thedotmack && npm install
```

### Register with Claude Code (Required!)

After install, register the marketplace so Claude Code recognizes the plugin:

```bash
# Run the install script (does this automatically)
~/.openclaw/skills/claude-mem/scripts/install.sh

# Or manually add to ~/.claude/plugins/known_marketplaces.json:
# "thedotmack": {"source": {"source": "github", "repo": "thedotmack/claude-mem"}, ...}
```

This ensures all Claude Code sessions (including OpenClaw-spawned coding agents) use claude-mem.

## How It Works

1. **5 Lifecycle Hooks** capture tool usage, prompts, and session events
2. **Worker Service** (port 37777) provides HTTP API and web viewer
3. **SQLite + Chroma** store sessions, observations, and vector embeddings
4. **MCP Search Tools** enable intelligent context retrieval

## Search Pattern (Token Efficient)

The 3-layer workflow saves ~10x tokens:

```
1. search      → Get compact index (~50-100 tokens/result)
2. timeline    → Get chronological context around results
3. get_observations → Fetch full details ONLY for filtered IDs
```

Example:
```javascript
// Step 1: Search index
search(query="authentication bug", type="bugfix", limit=10)

// Step 2: Review, identify relevant IDs (#123, #456)

// Step 3: Fetch full details
get_observations(ids=[123, 456])
```

## Configuration

Settings at `~/.claude-mem/settings.json`:

```json
{
  "model": "claude-sonnet-4-20250514",
  "workerPort": 37777,
  "dataDir": "~/.claude-mem/data",
  "logLevel": "info"
}
```

## Web Viewer

Access at http://localhost:37777 to:
- View real-time memory stream
- Browse sessions and observations
- Search history
- Configure settings
- Switch between stable/beta versions

## MCP Tools

| Tool | Purpose | Tokens |
|------|---------|--------|
| `search` | Query memory index | ~50-100/result |
| `timeline` | Chronological context | ~100-200/result |
| `get_observations` | Full observation details | ~500-1000/result |

## Troubleshooting

Describe issues to Claude - the `troubleshoot` skill auto-diagnoses.

Common fixes:
```bash
# Restart worker
curl http://localhost:37777/api/restart

# Check status
curl http://localhost:37777/api/status

# View logs
tail -f ~/.claude-mem/logs/worker.log
```

## Resources

- [Documentation](https://docs.claude-mem.ai)
- [GitHub](https://github.com/thedotmack/claude-mem)
- [Discord](https://discord.com/invite/J4wttp9vDu)
- [@Claude_Memory](https://x.com/Claude_Memory)

## License

AGPL-3.0 - See [LICENSE](https://github.com/thedotmack/claude-mem/blob/main/LICENSE)
