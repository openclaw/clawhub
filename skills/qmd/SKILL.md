---
name: qmd
description: Semantic search and retrieval tool for local files. Uses embeddings and BM25 search to find context.
metadata: {
  "clawdbot": {
    "emoji": "🔍",
    "requires": {
      "bins": ["qmd"]
    },
    "nix": {
      "packages": ["github:tobi/qmd"]
    },
    "notes": [
      "Use 'qmd query' for best results (combined search + reranking).",
      "Use 'qmd vsearch' for pure vector similarity.",
      "Use 'qmd search' for exact keyword matching (BM25).",
      "Run 'qmd update --pull' to refresh index."
    ]
  }
}
---

# QMD (Query Markdown Documents)

QMD is a powerful **local-first** search tool that indexes your documents for both semantic (vector) and keyword (BM25) search. Use it to find relevant context, code snippets, or documentation within your projects.

It is maintained by **Tobi** and the source code is available at [https://github.com/tobi/qmd](https://github.com/tobi/qmd).

## 🔒 Privacy & Security

**QMD is 100% Local.**
- No data is sent to the cloud.
- All embeddings and indexes are stored on your machine at `~/.cache/qmd/`.
- Your personal library remains private and is NEVER shared when you use this skill.

## 📥 Installation

### Via Nix (Recommended)
QMD is Flake-enabled and can be run directly:
```bash
nix run github:tobi/qmd -- search "your query"
```
Or enter a shell with `qmd` available:
```bash
nix shell github:tobi/qmd
```

### Via Bun
```bash
bun install -g https://github.com/tobi/qmd
```
*Requires Bun >= 1.0.0 and SQLite with extension support.*

## 🔌 Connect Your Data

QMD can index any directory on your computer. Here is how to connect your personal knowledge bases.

### Obsidian
Obsidian vaults are just folders of Markdown files, which QMD loves.
```bash
# Add your vault as a collection
qmd collection add ~/Documents/MyObsidianVault --name obsidian --mask "**/*.md"

# Search only your vault
qmd query "project alpha notes" -c obsidian
```

### Notion
QMD cannot read directly from Notion's API. You must **export** your workspace to Markdown first.
1. In Notion, go to **Settings & Members** > **Settings** > **Export all workspace content**.
2. Select **Markdown & CSV** format.
3. Unzip the download to a local folder (e.g., `~/Documents/NotionBackup`).
4. Index it with QMD:
   ```bash
   qmd collection add ~/Documents/NotionBackup --name notion --mask "**/*.md"
   ```

### VS Code / Coding Projects
Index your current project to give the bot context about your codebase:
```bash
# Index the current directory (default)
qmd update
```

## ⚙️ Configuration

You can persistently configure collections in `~/.config/qmd/index.yml`.

```yaml
# ~/.config/qmd/index.yml
global_context: "You are an intelligent assistant searching my personal knowledge base."

collections:
  Obsidian:
    path: ~/Documents/ObsidianVault
    pattern: "**/*.md"
    context:
      "/": "Personal notes and journals"
  Work:
    path: ~/Projects/WorkDocs
    pattern: "**/*.{md,txt}"
```

## 🔍 Core Commands

### 1. Smart Search (Hybrid)
**Use this by default.** It combines BM25 keyword search, Vector semantic search, and LLM Reranking for the best results.
```bash
qmd query "how does authentication work?"
```

### 2. Output Formats (Crucial for AI)
Always use structured output when reading results:
```bash
# BEST: JSON output (rich metadata + snippets)
qmd query "database schema" --json

# GOOD: Markdown output (clean context)
qmd query "api endpoints" --md

# FAST: File list only (minimal token usage)
qmd query "utils" --files
```

### 3. Context & Collection Management
Help QMD understand your files by adding descriptions:
```bash
# Give QMD a hint about a folder's content
qmd context add qmd://src/auth "Authentication logic and user session management"
```

## 🛠️ Troubleshooting

**"Command not found"**
If `qmd` is installed but not in your PATH, verify your installation:
- **Bun:** Check `~/.bun/bin` is in your PATH.
- **Nix:** Ensure you are in the `nix shell`.

**"Index seems empty"**
If search returns nothing:
```bash
# Force a full re-index
qmd update --pull
```

## Full Help Reference
```
  qmd multi-get <pattern> [-l N] [--max-bytes N]  - Get multiple docs by glob or comma-separated list
  qmd status                    - Show index status and collections
  qmd update [--pull]           - Re-index all collections (--pull: git pull first)
  qmd embed [-f]                - Create vector embeddings (800 tokens/chunk, 15% overlap)
  qmd cleanup                   - Remove cache and orphaned data, vacuum DB
  qmd search <query>            - Full-text search (BM25)
  qmd vsearch <query>           - Vector similarity search
  qmd query <query>             - Combined search with query expansion + reranking
  qmd mcp                       - Start MCP server (for AI agent integration)
  
  ... (see 'qmd --help' for full flags)
```
