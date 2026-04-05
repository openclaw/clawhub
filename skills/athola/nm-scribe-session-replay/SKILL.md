---
name: session-replay
description: |
  Convert a Claude Code session JSONL file into an animated GIF replay showing the conversation as typed terminal output
version: 1.8.1
triggers:
  - recording
  - demo
  - session-capture
  - gif
  - terminal
  - replay
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/scribe", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.scry:vhs-recording"]}}}
source: claude-night-market
source_plugin: scribe
---

> **Night Market Skill** — ported from [claude-night-market/scribe](https://github.com/athola/claude-night-market/tree/master/plugins/scribe). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Session Replay

Turn a Claude Code session JSONL file into an animated GIF
that plays back the conversation as typed terminal output.

The skill orchestrates three steps: parse the session file
into turns, generate a VHS tape from those turns, and hand
off to scry for GIF rendering.

## When To Use

- Creating demos of development workflows
- Adding visual evidence to pull requests
- Sharing session highlights to Slack or GitHub
- Embedding session replays in tutorials

## When NOT To Use

- Writing blog posts from sessions (use `scribe:session-to-post`)
- Generating API documentation (use `scribe:doc-generator`)
- Recording live terminal commands (use `scry:vhs-recording` directly)

## Integration Points

| Need | Skill | What it adds |
|------|-------|-------------|
| GIF rendering | `scry:vhs-recording` | Converts VHS tape to animated GIF |
| Tutorial embedding | `scribe:tech-tutorial` | Embed GIF in tutorial markdown |
| PR preparation | `sanctum:prepare-pr` | Attach replay as PR evidence |

## Workflow

### Step 0: Pick a Session (when no path is provided)

When the user invokes `/session-replay` without a path argument,
use `scribe.session_parser.list_sessions()` to discover recent
session files from `~/.claude/projects/`.

The function returns a list of `SessionInfo` objects sorted by
modification time (most recent first), each containing:

- `path` -- full path to the .jsonl file
- `modified` -- mtime timestamp
- `first_user_message` -- preview of the first human message
- `turn_count` -- number of user turns in the session
- `project_name` -- parent directory name

Present the list to the user as a numbered menu:

```
Recent sessions:
 1. [my-project] "implement auth module" (8 turns, 2h ago)
 2. [api-server] "fix rate limiting bug" (3 turns, 5h ago)
 3. [docs-site]  "update installation guide" (12 turns, 1d ago)
```

Ask the user to pick a number. Use the selected session's
`path` for the remaining steps.

If `list_sessions` returns an empty list, report that no
sessions were found and suggest providing a path directly.

### Step 1: Parse the Session

Use `scribe.session_parser.parse_session()` to read the JSONL
file. The parser:

- Extracts user and assistant turns
- Skips sidechain (subagent) records
- Collapses tool calls into readable summaries
- Wraps text at the configured column width
- Truncates long responses at the configured row count

Apply filters based on user options:

- `--turns` selects specific turn ranges (e.g. `1-5`)
- `--show` controls which layers appear: `user`, `assistant`,
  `tools`, `thinking` (thinking is excluded by default)

### Step 2: Generate VHS Tape

Use `scribe.tape_generator.generate_tape()` to convert the
parsed turns into a VHS tape file. The generator:

- Creates the Output directive and Set commands
- Types user messages at 30ms/char with `$ ` prefix
- Types assistant responses at 15ms/char
- Types tool summaries at 100ms with two-space indent
- Adds 1.5s pauses between turns
- Holds the final frame for 3s
- Scales all timing by the `--speed` multiplier
- Truncates when `--max-duration` is exceeded

Write the tape to a temp file:
`{tempdir}/session-replay-{timestamp}.tape`

### Step 3: Render GIF

Invoke `Skill(scry:vhs-recording)` with the tape file path.
Scry validates the tape, runs VHS, and produces the GIF at
the path specified in the Output directive.

After successful rendering, delete the temp tape file.

### Error Handling

| Error | Action |
|-------|--------|
| VHS not installed | Report: install via `go install github.com/charmbracelet/vhs@latest` |
| Tape syntax error | Report VHS error output. Likely a string escaping bug. |
| GIF generation fails | Report VHS error. Suggest `--turns 1-5` to reduce scope. |
| Scry skill not found | Report: scry plugin required for GIF rendering. |

## Example

```bash
# Pick from recent sessions interactively
/session-replay

# Replay a specific file directly
/session-replay ~/.claude/projects/my-project/abc123.jsonl

# First 5 turns only, faster playback
/session-replay --turns 1-5 --speed 1.5

# Show only the conversation, no tool calls
/session-replay --show user,assistant --output demo.gif
```

Output (interactive picker):

```
Recent sessions:
 1. [my-project] "implement auth module" (8 turns, 2h ago)
 2. [api-server] "fix rate limiting bug" (3 turns, 5h ago)
 3. [docs-site]  "update installation guide" (12 turns, 1d ago)

Pick a session [1-3]: 1

Parsed 42 turns from session (12 user, 15 assistant, 15 tools)
Generated tape: /tmp/session-replay-1711234567.tape
Rendering GIF via scry...
Done: session-replay.gif (18s, 960x540)
```
