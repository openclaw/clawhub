---
name: token-conservation
description: |
  Enforce token quota management at session start with conservation rules, delegation checks, and compression review
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conserve", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: conserve
---

> **Night Market Skill** — ported from [claude-night-market/conserve](https://github.com/athola/claude-night-market/tree/master/plugins/conserve). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Token Conservation Workflow

## When To Use
- Run at the start of every session and whenever prompt sizes or tool calls begin to spike.
- Mandatory before launching long-running analyses, wide diffs, or massive context loads.

## When NOT To Use

- Context-optimization already handles the scenario
- Simple queries with minimal context

## Required TodoWrite Items
1. `token-conservation:quota-check`
2. `token-conservation:context-plan`
3. `token-conservation:delegation-check`
4. `token-conservation:compression-review`
5. `token-conservation:logging`

## Step 1 – Quota Check (`quota-check`)
- Record current session duration and weekly usage (from `/status` or notebook).
  Note the 5-hour rolling cap + weekly cap highlighted in the Claude community notice.
- Capture remaining budget and set a max token target for this task.

## Step 2 – Context Plan (`context-plan`)
- **Set a discovery read budget BEFORE reading any files.** Count each `Read` call
  and each content-mode `Grep` as one read. Glob and files-with-matches Grep are free.
  - Implement from spec/requirements: **max 8 reads**
  - Bug fix at known location: **max 5 reads**
  - Refactor with known scope: **max 1 read per file being changed**
  - Open exploration: **max 15 reads**
- **Read order** (most valuable first): spec/requirements, files to modify,
  imports/interfaces, then stop and start writing.
- **When budget is spent**: ask the user if more context is needed. Do NOT
  self-authorize additional reads. Only explicit user approval overrides the budget.
- Prefer `Read` with `offset`/`limit` params or `Grep` tool over loading whole files.
  A `Read` targeting <50 lines counts as 0.5 reads. Avoid `cat`/`sed`/`awk` via Bash
  — Claude Code 2.1.21+ steers toward native file tools (Read, Edit, Write, Grep, Glob).
- **PDFs (Claude Code 2.1.30+)**: Use `Read` with `pages: "1-5"` for targeted PDF reading
  instead of loading entire documents. Large PDFs (>10 pages) return a lightweight
  reference when @-mentioned — use the `pages` parameter to read specific sections.
  Hard limits: **100 pages max, 20MB max per PDF**. Exceeding these previously locked
  sessions permanently (fixed in 2.1.31).
- Convert prose instructions into bullet lists before prompting so only essential
  info hits the model.

## Step 3 – Delegation Check (`delegation-check`)
- Evaluate whether compute-intensive tasks can go to Qwen MCP or other external
  tooling (use `qwen-delegation` skill if needed).
- For local work, favor deterministic scripts (formatters, analyzers) instead
  of LLM reasoning when possible.

## Step 4 – Compression Review (`compression-review`)
- Summarize prior steps/results before adding new context.
  Remove redundant history, collapse logs, and avoid reposting identical code.
- Use `prompt caching` ideas: reference prior outputs instead of restating them
  when the model has already processed the information (cite snippet IDs).
- Decide whether the current thread should be compacted:
  - If only recent context is stale, use **"Summarize from here"** (Claude Code 2.1.32+)
    via the message selector to partially summarize the conversation — this preserves
    recent context while compressing older portions
  - If the active workflow is finished and earlier context will not be reused,
    instruct the user to run `/new`
  - If progress requires the existing thread but the window is bloated,
    prompt them to run `/compact` before continuing
- **Automatic memory** (Claude Code 2.1.32+): Claude now records and recalls session
  memories automatically. This adds minor token overhead but improves cross-session
  continuity. No action needed — be aware it contributes to baseline context usage.

## Step 5 – Logging (`logging`)

Document the conservation tactics that were applied and note the remaining
token budget. If the budget is low, explicitly warn the user and propose secondary
plans. Record any recommendations made regarding the use of `/new` or `/compact`,
or justify why neither was necessary, to inform future context-handling decisions.

## Output Expectations
- A short explanation of token-saving steps, delegated tasks, and remaining runway.
- Concrete next-action list that keeps the conversation lean (e.g.):
  - "next turn: provide only failing test output lines 40-60"
- Explicit reminder about `/new` or `/compact` whenever you determine it would save
  tokens (otherwise state that no reset/compaction is needed yet).
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
