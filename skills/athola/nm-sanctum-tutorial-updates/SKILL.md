---
name: tutorial-updates
description: |
  Generate tutorials from VHS tapes and Playwright specs with dual-tone markdown and GIF recording
version: 1.8.1
triggers:
  - tutorial
  - gif
  - vhs
  - playwright
  - documentation
  - demo
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:shared", "night-market.sanctum:git-workspace-review", "night-market.scry:vhs-recording", "night-market.scry:browser-recording", "night-market.scry:gif-generation", "night-market.scry:media-composition"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Command Options](#command-options)
- [Required TodoWrite Items](#required-todowrite-items)
- [Phase 1: Discovery (`tutorial-updates:discovery`)](#phase-1:-discovery-(tutorial-updates:discovery))
- [Step 1.1: Locate Tutorial Assets](#step-11:-locate-tutorial-assets)
- [Step 1.2: Parse Manifests](#step-12:-parse-manifests)
- [Step 1.3: Handle Options](#step-13:-handle-options)
- [Phase 1.5: Validation (`tutorial-updates:validation`)](#phase-15:-validation-(tutorial-updates:validation))
- [Step 1.5.1: VHS Syntax Validation](#step-151:-vhs-syntax-validation)
- [Step 1.5.2: Extract and Validate CLI Commands](#step-152:-extract-and-validate-cli-commands)
- [Step 1.5.3: Verify Demo Data Exists](#step-153:-verify-demo-data-exists)
- [Step 1.5.4: Test Commands Locally](#step-154:-test-commands-locally)
- [Validation Flags](#validation-flags)
- [Validation Exit Criteria](#validation-exit-criteria)
- [Phase 1.6: Binary Rebuild (`tutorial-updates:rebuild`)](#phase-16:-binary-rebuild-(tutorial-updates:rebuild))
- [Step 1.6.1: Detect Build System](#step-161:-detect-build-system)
- [Step 1.6.2: Check Binary Freshness](#step-162:-check-binary-freshness)
- [Step 1.6.3: Rebuild Binary](#step-163:-rebuild-binary)
- [Step 1.6.4: Verify Binary Accessibility](#step-164:-verify-binary-accessibility)
- [Rebuild Flags](#rebuild-flags)
- [Rebuild Exit Criteria](#rebuild-exit-criteria)
- [Phase 2: Recording (`tutorial-updates:recording`)](#phase-2:-recording-(tutorial-updates:recording))
- [Step 2.1: Process Tape Components](#step-21:-process-tape-components)
- [Step 2.2: Process Browser Components](#step-22:-process-browser-components)
- [Step 2.3: Handle Multi-Component Tutorials](#step-23:-handle-multi-component-tutorials)
- [Phase 3: Generation (`tutorial-updates:generation`)](#phase-3:-generation-(tutorial-updates:generation))
- [Step 3.1: Parse Tape Annotations](#step-31:-parse-tape-annotations)
- [Step 3.2: Generate Dual-Tone Markdown](#step-32:-generate-dual-tone-markdown)
- [Step 3.3: Generate README Demo Section](#step-33:-generate-readme-demo-section)
- [Demos](#demos)
- [Quickstart](#quickstart)
- [Phase 4: Integration (`tutorial-updates:integration`)](#phase-4:-integration-(tutorial-updates:integration))
- [Step 4.1: Verify All Outputs](#step-41:-verify-all-outputs)
- [Step 4.2: Update SUMMARY.md (Book)](#step-42:-update-summarymd-(book))
- [Step 4.3: Report Results](#step-43:-report-results)
- [Exit Criteria](#exit-criteria)
- [Error Handling](#error-handling)
- [Scaffold Mode](#scaffold-mode)


# Tutorial Updates Skill

Orchestrate tutorial generation with GIF recordings from VHS tape files and Playwright browser specs.


## When To Use

- Generating or updating user-facing tutorials
- Creating VHS and Playwright tutorial recordings

## When NOT To Use

- Internal documentation without user-facing tutorials
- API reference docs - use scribe:doc-generator instead

## Overview

This skill coordinates the complete tutorial generation pipeline:

1. Discover tape files and manifests in the project
2. Validate tape commands and check binary freshness
3. Rebuild binaries if stale so demos reflect latest code
4. Record terminal sessions using VHS (scry:vhs-recording)
5. Record browser sessions using Playwright (scry:browser-recording)
6. Generate optimized GIFs (scry:gif-generation)
7. Compose multi-component tutorials (scry:media-composition)
8. Generate dual-tone markdown for docs/ and book/

## Command Options

```bash
/update-tutorial quickstart        # Single tutorial by name
/update-tutorial sync mcp          # Multiple tutorials
/update-tutorial --all             # All tutorials with manifests
/update-tutorial --list            # Show available tutorials
/update-tutorial --scaffold        # Create structure without recording
```
**Verification:** Run the command with `--help` flag to verify availability.

## Required TodoWrite Items

Create todos with these prefixes for progress tracking:

```
**Verification:** Run the command with `--help` flag to verify availability.
- tutorial-updates:discovery
- tutorial-updates:validation
- tutorial-updates:rebuild
- tutorial-updates:recording
- tutorial-updates:generation
- tutorial-updates:integration
```
**Verification:** Run the command with `--help` flag to verify availability.

## Phase 1: Discovery (`tutorial-updates:discovery`)

### Step 1.1: Locate Tutorial Assets

Find tape files and manifests in the project:

```bash
# Find manifest files
find . -name "*.manifest.yaml" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  2>/dev/null | head -20

# Find tape files
find . -name "*.tape" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  2>/dev/null | head -20

# Find browser specs
find . -name "*.spec.ts" -path "*/browser/*" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  2>/dev/null | head -20
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 1.2: Parse Manifests

For each manifest file, extract:
- Tutorial name and title
- Component list (tape files, playwright specs)
- Output paths for GIFs
- Composition rules (layout, combine options)

See `modules/manifest-parsing.md` for manifest schema details.

### Step 1.3: Handle Options

| Option | Behavior |
|--------|----------|
| `--list` | Display discovered tutorials and exit |
| `--all` | Process all discovered manifests |
| `--scaffold` | Create directory structure and empty files without recording |
| `<names>` | Process only specified tutorials |

When `--list` is specified:
```
**Verification:** Run the command with `--help` flag to verify availability.
Available tutorials:
  quickstart     assets/tapes/quickstart.tape
  sync           assets/tapes/sync.tape (manifest)
  mcp            assets/tapes/mcp.manifest.yaml (terminal + browser)
  skill-debug    assets/tapes/skill-debug.tape
```
**Verification:** Run the command with `--help` flag to verify availability.

## Phase 1.5: Validation (`tutorial-updates:validation`)

**CRITICAL**: Validate tape commands BEFORE running VHS to avoid expensive regeneration cycles.

See `modules/tape-validation.md` for detailed validation logic.

### Step 1.5.1: VHS Syntax Validation

Check each tape file for valid VHS syntax:

```bash
# Required: Output directive exists
grep -q '^Output ' "$tape_file" || echo "ERROR: Missing Output directive"

# Check for balanced quotes in Type directives
grep '^Type ' "$tape_file" | while read -r line; do
  quote_count=$(echo "$line" | tr -cd '"' | wc -c)
  if [ $((quote_count % 2)) -ne 0 ]; then
    echo "ERROR: Unbalanced quotes: $line"
  fi
done
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 1.5.2: Extract and Validate CLI Commands

For each `Type` directive, extract the command and validate flags:

```bash
# Extract commands from Type directives
grep '^Type ' "$tape_file" | sed 's/^Type "//' | sed 's/"$//' | while read -r cmd; do
  # Skip comments, clear, and echo commands
  [[ "$cmd" =~ ^# ]] && continue
  [[ "$cmd" == "clear" ]] && continue

  # For skrills commands, validate flags exist
  if [[ "$cmd" =~ ^skrills ]]; then
    base_cmd=$(echo "$cmd" | awk '{print $1, $2}')
    flags=$(echo "$cmd" | grep -oE '\-\-[a-zA-Z0-9-]+' || true)

    for flag in $flags; do
      if ! $base_cmd --help 2>&1 | grep -q -- "$flag"; then
        echo "ERROR: Invalid flag '$flag' in command: $cmd"
      fi
    done
  fi
done
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 1.5.3: Verify Demo Data Exists

If the tape uses demo data, verify it exists and is populated:

```bash
# Check SKRILLS_SKILL_DIR if set
skill_dir=$(grep '^Env SKRILLS_SKILL_DIR' "$tape_file" | sed 's/.*"\(.*\)"/\1/')
if [ -n "$skill_dir" ]; then
  if [ ! -d "$skill_dir" ]; then
    echo "ERROR: Demo skill directory missing: $skill_dir"
  else
    skill_count=$(find "$skill_dir" -name "SKILL.md" 2>/dev/null | wc -l)
    if [ "$skill_count" -eq 0 ]; then
      echo "ERROR: No skills in demo directory: $skill_dir"
    else
      echo "OK: Found $skill_count demo skills in $skill_dir"
    fi
  fi
fi
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 1.5.4: Test Commands Locally

**CRITICAL**: Run each extracted command locally to verify it produces expected output:

```bash
# For each command in the tape, do a quick sanity check
# This catches issues like:
# - Commands that exit with non-zero status
# - Commands that produce no output (won't show anything in GIF)
# - Commands that require user input (will hang VHS)

for cmd in $(extract_commands "$tape_file"); do
  # Run with timeout to catch hanging commands
  if ! timeout 5s bash -c "$cmd" &>/dev/null; then
    echo "WARNING: Command may fail or hang: $cmd"
  fi
done
```
**Verification:** Run the command with `--help` flag to verify availability.

### Validation Flags

| Flag | Behavior |
|------|----------|
| `--validate-only` | Run validation without generating GIF |
| `--skip-validation` | Bypass validation for rapid regeneration |

### Validation Exit Criteria

- [ ] VHS tape syntax is valid (Output directive, balanced quotes)
- [ ] All CLI flags in commands are valid (verified against --help)
- [ ] Demo data directories exist and are populated
- [ ] Commands execute successfully with expected output

**If validation fails**: Stop immediately, report errors, and do NOT proceed to VHS recording.

## Phase 1.6: Binary Rebuild (`tutorial-updates:rebuild`)

**CRITICAL**: Ensure the binary being tested in tapes matches the latest source code. Stale binaries produce misleading demos.

### Step 1.6.1: Detect Build System

Identify the project's build system:

```bash
# Check for Cargo (Rust)
if [ -f "Cargo.toml" ]; then
  BUILD_SYSTEM="cargo"
  BINARY_NAME=$(grep '^name = ' Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
  echo "Detected Cargo project: $BINARY_NAME"
# Check for Makefile
elif [ -f "Makefile" ]; then
  BUILD_SYSTEM="make"
  echo "Detected Make project"
# Unknown
else
  echo "WARNING: Unknown build system, skipping binary check"
  BUILD_SYSTEM="unknown"
fi
```
**Verification:** Run `make --dry-run` to verify build configuration.

### Step 1.6.2: Check Binary Freshness

Compare binary modification time against Git HEAD:

```bash
check_binary_freshness() {
  local binary_name="$1"

  # Locate binary (check cargo install location first, then PATH)
  local binary_path=$(which "$binary_name" 2>/dev/null)

  if [ -z "$binary_path" ]; then
    echo "WARNING: Binary '$binary_name' not found in PATH"
    return 1
  fi

  # Get binary modification time (Linux/macOS compatible)
  local binary_mtime
  if command -v stat >/dev/null 2>&1; then
    # Linux
    binary_mtime=$(stat -c %Y "$binary_path" 2>/dev/null || \
    # macOS
    stat -f %m "$binary_path" 2>/dev/null)
  else
    echo "WARNING: stat command not available, skipping freshness check"
    return 2
  fi

  # Get Git HEAD commit time
  local git_head_time=$(git log -1 --format=%ct 2>/dev/null)

  if [ -z "$git_head_time" ]; then
    echo "WARNING: Not a git repository, skipping freshness check"
    return 2
  fi

  # Compare timestamps
  if [ "$binary_mtime" -lt "$git_head_time" ]; then
    echo "STALE: Binary is older than Git HEAD"
    echo "  Binary: $(date -d @$binary_mtime 2>/dev/null || date -r $binary_mtime)"
    echo "  HEAD:   $(date -d @$git_head_time 2>/dev/null || date -r $git_head_time)"
    return 1
  else
    echo "OK: Binary is up-to-date"
    return 0
  fi
}
```
**Verification:** Run `git status` to confirm working tree state.

### Step 1.6.3: Rebuild Binary

Rebuild using the detected build system:

```bash
rebuild_binary() {
  local build_system="$1"
  local binary_name="$2"

  case "$build_system" in
    cargo)
      echo "Rebuilding with Cargo..."
      # Use cargo install for CLI binaries
      if [ -d "crates/cli" ]; then
        cargo install --path crates/cli --locked --quiet
      else
        cargo install --path . --locked --quiet
      fi
      ;;
    make)
      echo "Rebuilding with Make..."
      make build --quiet
      ;;
    *)
      echo "ERROR: Cannot rebuild, unknown build system"
      return 1
      ;;
  esac

  echo "Build complete: $binary_name"
}
```
**Verification:** Run `make --dry-run` to verify build configuration.

### Step 1.6.4: Verify Binary Accessibility

Ensure the rebuilt binary is accessible:

```bash
verify_binary() {
  local binary_name="$1"

  if ! command -v "$binary_name" >/dev/null 2>&1; then
    echo "ERROR: Binary '$binary_name' not found after rebuild"
    echo "  Check PATH includes: $HOME/.cargo/bin"
    return 1
  fi

  # Test binary can execute
  if ! "$binary_name" --version >/dev/null 2>&1; then
    echo "WARNING: Binary exists but --version failed"
  else
    echo "OK: Binary is accessible and functional"
    "$binary_name" --version
  fi
}
```
**Verification:** Run `pytest -v` to verify tests pass.

### Rebuild Flags

| Flag | Behavior |
|------|----------|
| `--skip-rebuild` | Skip binary freshness check and rebuild |
| `--force-rebuild` | Force rebuild even if binary is fresh |

### Rebuild Exit Criteria

- [ ] Build system detected (Cargo, Make, or explicitly skipped)
- [ ] Binary freshness checked against Git HEAD
- [ ] Binary rebuilt if stale (or forced)
- [ ] Rebuilt binary is accessible in PATH
- [ ] Binary executes successfully (--version test)

**If rebuild fails**: Stop immediately, report build errors, and do NOT proceed to tape validation or VHS recording.

## Phase 2: Recording (`tutorial-updates:recording`)

### Step 2.1: Process Tape Components

For each tape file component:

1. Parse tape file for metadata annotations (@step, @docs-brief, @book-detail)
2. Validate Output directive exists
3. Invoke `Skill(scry:vhs-recording)` with tape file path
4. Verify GIF output was created

### Step 2.2: Process Browser Components

For each playwright spec component:

1. Check `requires` field for prerequisite commands (e.g., start server)
2. Launch any required background processes
3. Invoke `Skill(scry:browser-recording)` with spec path
4. Stop background processes
5. Invoke `Skill(scry:gif-generation)` to convert WebM to GIF

### Step 2.3: Handle Multi-Component Tutorials

For manifests with `combine` section:

1. Verify all component GIFs exist
2. Invoke `Skill(scry:media-composition)` with manifest
3. Verify combined output was created

## Phase 3: Generation (`tutorial-updates:generation`)

### Step 3.1: Parse Tape Annotations

Extract documentation content from tape files:

```tape
# @step Install skrills
# @docs-brief Install via cargo
# @book-detail The recommended installation method uses cargo...
Type "cargo install skrills"
```
**Verification:** Run the command with `--help` flag to verify availability.

Annotations:
- `@step` - Step title/heading
- `@docs-brief` - Concise text for project docs (docs/ directory)
- `@book-detail` - Extended text for technical book (book/ directory)

### Step 3.2: Generate Dual-Tone Markdown

Generate two versions of each tutorial:

1. **Project docs** (`docs/tutorials/<name>.md`)
   - Brief, action-oriented
   - Uses @docs-brief content
   - Focuses on commands and quick results

2. **Technical book** (`book/src/tutorials/<name>.md`)
   - Detailed, educational
   - Uses @book-detail content
   - Explains concepts and rationale

See `modules/markdown-generation.md` for formatting details.

### Step 3.3: Generate README Demo Section

Create or update demo section in README.md:

```markdown
## Demos

### Quickstart
![Quickstart demo](assets/gifs/quickstart.gif)
*Install, validate, analyze, and serve in under a minute. [Full tutorial](docs/tutorials/quickstart.md)*
```
**Verification:** Run the command with `--help` flag to verify availability.

## Phase 4: Integration (`tutorial-updates:integration`)

### Step 4.1: Verify All Outputs

Confirm all expected files exist:

```bash
# Check GIF files
for gif in assets/gifs/*.gif; do
  if [[ -f "$gif" ]]; then
    echo "OK: $gif ($(du -h "$gif" | cut -f1))"
  else
    echo "MISSING: $gif"
  fi
done

# Check markdown files
ls -la docs/tutorials/*.md 2>/dev/null
ls -la book/src/tutorials/*.md 2>/dev/null
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 4.2: Update SUMMARY.md (Book)

If the project has an mdBook structure, update `book/src/SUMMARY.md`:

```markdown
- [Tutorials](./tutorials/README.md)
  - [Quickstart](./tutorials/quickstart.md)
  - [Sync Workflow](./tutorials/sync.md)
  - [MCP Integration](./tutorials/mcp.md)
  - [Skill Debugging](./tutorials/skill-debug.md)
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 4.3: Report Results

Summarize the update:

```
**Verification:** Run the command with `--help` flag to verify availability.
Tutorial Update Complete
========================
Tutorials processed: 4
GIFs generated: 5
  - quickstart.gif (1.2MB)
  - sync.gif (980KB)
  - mcp-terminal.gif (1.5MB)
  - mcp-browser.gif (2.1MB)
  - skill-debug.gif (890KB)

Markdown generated:
  - docs/tutorials/ (4 files)
  - book/src/tutorials/ (4 files)

README demo section updated
```
**Verification:** Run the command with `--help` flag to verify availability.

## Exit Criteria

- [ ] All specified tutorials processed (or all if --all)
- [ ] GIF files created at manifest-specified paths
- [ ] Dual-tone markdown generated for each tutorial
- [ ] README demo section updated with GIF embeds
- [ ] Book SUMMARY.md updated (if applicable)
- [ ] All TodoWrite items completed

## Error Handling

| Error | Resolution |
|-------|------------|
| VHS not installed | `go install github.com/charmbracelet/vhs@latest` |
| Playwright not installed | `npm install -D @playwright/test && npx playwright install chromium` |
| Tape file missing Output | Add `Output assets/gifs/<name>.gif` directive |
| Browser spec requires server | Start server before running spec |
| GIF too large | Adjust fps/scale in gif-generation |

## Scaffold Mode

When `--scaffold` is specified, create structure without recording:

1. Create `assets/tapes/` directory
2. Create `assets/gifs/` directory
3. Create `assets/browser/` directory (if browser tutorials planned)
4. Create template tape file with metadata annotations
5. Create template manifest file
6. Create empty markdown files in docs/tutorials/ and book/src/tutorials/

Template tape file:
```tape
# @title: Tutorial Name
# @description: Brief description of the tutorial

Output assets/gifs/tutorial-name.gif
Set FontSize 14
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"

# @step Step 1 Title
# @docs-brief Brief docs text
# @book-detail Extended book text with more context and explanation
Type "command here"
Enter
Sleep 2s
```
**Verification:** Run the command with `--help` flag to verify availability.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
