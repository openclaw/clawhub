---
name: vhs-recording
description: Generate terminal recordings using VHS tape files, produces GIF outputs
version: 1.8.1
triggers:
  - vhs
  - terminal
  - recording
  - gif
  - demo
  - tutorial
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/scry", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: scry
---

> **Night Market Skill** — ported from [claude-night-market/scry](https://github.com/athola/claude-night-market/tree/master/plugins/scry). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# VHS Recording Skill

Generate professional terminal recordings from VHS tape files.


## When To Use

- Recording terminal sessions with VHS tape scripts
- Creating terminal demo recordings for documentation

## When NOT To Use

- Browser-based workflows - use scry:browser-recording instead
- Non-terminal demos or GUI applications

## Overview

VHS converts declarative tape files into animated GIFs of terminal sessions. Tape files define commands, timing, and terminal appearance.

## Required TodoWrite Items

```
- Locate and validate tape file
- Check VHS installation status
- Execute VHS recording
- Verify output GIF creation
```

## Module Reference

- See `modules/tape-syntax.md` for VHS tape file directives
- See `modules/execution.md` for recording workflow details

## Workflow

### Phase 1: Validate Tape File

1. Confirm tape file exists at specified path
2. Read tape file contents
3. Verify required directives:
   - `Output` directive specifies GIF destination
   - At least one action command (Type, Enter, etc.)

### Phase 2: Check VHS Installation

```bash
which vhs && vhs --version
```

If not installed:
```bash
# Linux/WSL
go install github.com/charmbracelet/vhs@latest

# macOS
brew install charmbracelet/tap/vhs

# Also requires ttyd and ffmpeg
```

### Phase 3: Execute Recording

```bash
vhs <tape-file.tape>
```

VHS will:
1. Parse tape file directives
2. Launch virtual terminal (ttyd)
3. Execute commands with timing
4. Capture frames
5. Encode to GIF using ffmpeg

### Phase 4: Verify Output

1. Check GIF file exists at Output path
2. Verify file size is non-zero
3. Report success with output location

## Exit Criteria

- GIF file created at specified Output path
- File size indicates successful recording (typically >50KB)
- No error messages from VHS execution
## Troubleshooting

### Common Issues

If `vhs` is not found, verify that your Go bin directory is in your `PATH` (typically `~/go/bin`). If the recording fails to start, ensure `ttyd` and `ffmpeg` are installed, as VHS depends on them for terminal emulation and video encoding. For "permission denied" errors when writing the GIF, check that the output directory exists and is writable.
