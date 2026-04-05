# Tape Validation Module

Pre-flight validation for VHS tape files before GIF generation. Validate commands work correctly and demo data exists BEFORE running the time-consuming VHS recording.

## Overview

This module catches errors early:
- Stale binaries detected before recording (Phase 0)
- Invalid CLI flags discovered before GIF generation
- Missing demo data detected before recording starts
- VHS syntax issues reported before execution

## Validation Phases

### Phase 0: Binary Freshness Check

**CRITICAL**: Verify the CLI binary matches the latest source code. Stale binaries produce misleading demos.

```bash
# Check if binary is older than Git HEAD
check_binary_freshness() {
  local binary_name="$1"

  # Locate binary in PATH
  local binary_path=$(which "$binary_name" 2>/dev/null)

  if [ -z "$binary_path" ]; then
    echo "WARNING: Binary '$binary_name' not found in PATH"
    return 1
  fi

  # Get binary modification time (Linux/macOS compatible)
  local binary_mtime
  binary_mtime=$(stat -c %Y "$binary_path" 2>/dev/null || \
                 stat -f %m "$binary_path" 2>/dev/null)

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
    echo ""
    echo "RECOMMENDATION: Rebuild binary before recording tape"
    echo "  cargo install --path crates/cli --locked"
    return 1
  else
    echo "OK: Binary is up-to-date with Git HEAD"
    return 0
  fi
}
```

**Error handling**:
- Exit code 0: Binary is fresh
- Exit code 1: Binary is stale (older than HEAD)
- Exit code 2: Cannot determine (not in git repo or binary not found)

**Integration**:
```bash
# Run before tape validation
check_binary_freshness "skrills"
if [ $? -eq 1 ]; then
  echo "ERROR: Stale binary detected"
  echo "Run 'cargo install --path crates/cli --locked' to rebuild"
  exit 1
fi
```

## Command Validation Phases

### 1. VHS Syntax Validation

Check that the tape file has valid VHS syntax:

```bash
# Required: Output directive
grep -q '^Output ' "$tape_file" || echo "ERROR: Missing Output directive"

# Check for balanced quotes in Type directives
grep '^Type ' "$tape_file" | while read -r line; do
  # Count quotes (should be even)
  quote_count=$(echo "$line" | tr -cd '"' | wc -c)
  if [ $((quote_count % 2)) -ne 0 ]; then
    echo "ERROR: Unbalanced quotes in: $line"
  fi
done
```

**Error examples**:
- "Missing Output directive in quickstart.tape:1"
- "Unbalanced quotes in Type directive at quickstart.tape:15"

### 2. Command Extraction

Parse `Type` directives to extract shell commands:

```bash
# Extract commands from Type directives
extract_commands() {
  local tape_file="$1"
  grep '^Type ' "$tape_file" | \
    sed 's/^Type "//' | \
    sed 's/"$//' | \
    grep -v '^#' | \
    grep -v '^clear$' | \
    grep -v '^$'
}
```

**Example**:
```vhs
Type "skrills validate --errors-only"
```
Extracts: `skrills validate --errors-only`

### 3. CLI Flag Validation

For each extracted command, validate flags exist:

```bash
validate_command_flags() {
  local cmd="$1"
  local line_num="$2"

  # Extract the base command (e.g., "skrills validate")
  local base_cmd=$(echo "$cmd" | awk '{print $1, $2}')

  # Get help output for flag discovery
  local help_output=$($base_cmd --help 2>&1)

  # Extract flags from the command
  local flags=$(echo "$cmd" | grep -oE '\-\-[a-zA-Z0-9-]+')

  for flag in $flags; do
    if ! echo "$help_output" | grep -q -- "$flag"; then
      echo "ERROR: Invalid flag '$flag' at line $line_num"
      echo "  Command: $cmd"
      echo "  Run '$base_cmd --help' to see available flags"
    fi
  done
}
```

**Example validation**:
```bash
# Command from tape line 12
skrills create demo --sample basic

# Validation
$ skrills create --help | grep -- '--sample'
# (no output - flag doesn't exist)

# Error output
ERROR: Invalid flag '--sample' at line 12
  Command: skrills create demo --sample basic
  Run 'skrills create --help' to see available flags
```

### 4. Demo Data Verification

Check that demo directories and skills exist:

```bash
verify_demo_data() {
  local tape_file="$1"

  # Extract Env SKRILLS_SKILL_DIR if set
  local skill_dir=$(grep '^Env SKRILLS_SKILL_DIR' "$tape_file" | \
    sed 's/.*"\(.*\)"/\1/')

  if [ -n "$skill_dir" ]; then
    if [ ! -d "$skill_dir" ]; then
      echo "ERROR: Demo skill directory does not exist: $skill_dir"
      return 1
    fi

    # Check it has content
    local skill_count=$(find "$skill_dir" -name "SKILL.md" 2>/dev/null | wc -l)
    if [ "$skill_count" -eq 0 ]; then
      echo "ERROR: Demo skill directory is empty: $skill_dir"
      echo "  Expected at least one SKILL.md file"
      return 1
    fi

    echo "OK: Demo skills found: $skill_count skills in $skill_dir"
  fi

  # Check for other referenced directories
  grep '^Type.*mkdir\|^Type.*cp\|^Type.*cd' "$tape_file" | while read -r line; do
    # Extract directory paths and verify parent exists
    # This is optional - catches obvious path errors
    true
  done
}
```

### 5. Expected Output Verification

For commands that should produce visible output, verify they will:

```bash
verify_expected_output() {
  local cmd="$1"

  # Skip echo commands (always produce output)
  echo "$cmd" | grep -q '^echo ' && return 0

  # For skrills commands, do a dry-run to verify output
  if echo "$cmd" | grep -q '^skrills '; then
    # Run with --help to verify command exists
    local base=$(echo "$cmd" | awk '{print $1, $2}')
    if ! $base --help &>/dev/null; then
      echo "WARNING: Command may not produce output: $cmd"
    fi
  fi
}
```

## Complete Validation Script

```bash
#!/bin/bash
# validate_tape.sh - Pre-flight validation for VHS tape files

validate_tape() {
  local tape_file="$1"
  local errors=0

  echo "=== Validating: $tape_file ==="

  # Phase 1: Syntax
  echo "Phase 1: VHS Syntax..."
  if ! grep -q '^Output ' "$tape_file"; then
    echo "  ERROR: Missing Output directive"
    ((errors++))
  else
    echo "  OK: Output directive found"
  fi

  # Phase 2: Extract commands
  echo "Phase 2: Extracting commands..."
  local line_num=0
  local cmd_count=0
  while IFS= read -r line; do
    ((line_num++))
    if [[ "$line" =~ ^Type\ \" ]]; then
      cmd=$(echo "$line" | sed 's/^Type "//' | sed 's/"$//')
      ((cmd_count++))

      # Phase 3: Validate CLI flags
      if [[ "$cmd" =~ ^skrills ]]; then
        base_cmd=$(echo "$cmd" | awk '{print $1, $2}')
        flags=$(echo "$cmd" | grep -oE '\-\-[a-zA-Z0-9-]+' || true)

        if [ -n "$flags" ]; then
          help_output=$($base_cmd --help 2>&1 || echo "")
          for flag in $flags; do
            if ! echo "$help_output" | grep -q -- "$flag"; then
              echo "  ERROR: Invalid flag '$flag' at line $line_num"
              echo "         Command: $cmd"
              ((errors++))
            fi
          done
        fi
      fi
    fi
  done < "$tape_file"
  echo "  Extracted $cmd_count commands"

  # Phase 4: Demo data
  echo "Phase 4: Demo data verification..."
  skill_dir=$(grep '^Env SKRILLS_SKILL_DIR' "$tape_file" | sed 's/.*"\(.*\)"/\1/' || true)
  if [ -n "$skill_dir" ]; then
    if [ ! -d "$skill_dir" ]; then
      echo "  ERROR: Demo skill directory missing: $skill_dir"
      ((errors++))
    else
      skill_count=$(find "$skill_dir" -name "SKILL.md" 2>/dev/null | wc -l)
      if [ "$skill_count" -eq 0 ]; then
        echo "  ERROR: No skills in demo directory: $skill_dir"
        ((errors++))
      else
        echo "  OK: Found $skill_count demo skills"
      fi
    fi
  fi

  # Summary
  echo "=== Validation Complete ==="
  if [ "$errors" -eq 0 ]; then
    echo "PASSED: No errors found"
    return 0
  else
    echo "FAILED: $errors error(s) found"
    return 1
  fi
}

# Run if called directly
if [ -n "$1" ]; then
  validate_tape "$1"
fi
```

## Integration with Workflow

Before running VHS, execute validation:

```bash
# In the tutorial-updates skill Phase 1.5
validate_tape "$tape_file"
if [ $? -ne 0 ]; then
  echo "Validation failed. Fix errors before running VHS."
  exit 1
fi

# Proceed to VHS recording
vhs "$tape_file"
```

## Flags

### `--validate-only`

Run validation without generating GIF:

```bash
# Validate all tapes without recording
for tape in assets/tapes/*.tape; do
  validate_tape "$tape"
done
```

### `--skip-validation`

Bypass validation for rapid regeneration:

```bash
# Skip validation when commands are known-good
if [ "$SKIP_VALIDATION" != "true" ]; then
  validate_tape "$tape_file" || exit 1
fi
vhs "$tape_file"
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Validation passed |
| 1 | Validation failed (errors found) |
| 2 | Validation skipped (--skip-validation) |

## Error Message Format

Standardized format for actionable errors:

```
ERROR: <short-description> at line <number>
  Command: <full-command>
  <hint-or-available-options>
```

Example:
```
ERROR: Invalid flag '--sample' at line 12
  Command: skrills validate --sample 5
  Run 'skrills validate --help' to see available flags
```
