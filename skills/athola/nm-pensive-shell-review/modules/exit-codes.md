---
parent_skill: pensive:shell-review
module: exit-codes
description: Exit code propagation patterns and pipeline pitfalls
tags: [exit-codes, pipelines, error-handling, pipefail]
---

# Exit Code Patterns

## Critical: Pipeline Exit Codes

The default bash behavior is that a pipeline's exit code equals the **last** command's exit code. This masks failures:

```bash
# BAD - grep always succeeds if it finds lines, hiding make failure
if (make typecheck 2>&1 | grep -v "^make\["); then
    echo "Passed"  # WRONG - runs even when make fails!
fi
```

### Fix 1: Use pipefail

```bash
set -o pipefail

# Now pipeline fails if ANY command fails
if make typecheck 2>&1 | grep -v "^make\["; then
    echo "Passed"
fi
```

### Fix 2: Capture Output and Exit Code Separately

```bash
# Capture output, preserve exit code
local output
local exit_code=0
output=$(make typecheck 2>&1) || exit_code=$?

# Filter output for display
echo "$output" | grep -v "^make\[" || true

# Check actual exit code
if [ "$exit_code" -eq 0 ]; then
    echo "Passed"
else
    echo "Failed"
    return 1
fi
```

### Fix 3: Use PIPESTATUS (Bash-specific)

```bash
make typecheck 2>&1 | grep -v "^make\["
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    echo "Make failed"
    exit 1
fi
```

## Detection Commands

Find pipeline patterns that may mask failures:
```bash
# Commands piped to grep/head/tail (common culprits)
grep -n "| grep" scripts/*.sh
grep -n "| head" scripts/*.sh
grep -n "| tail" scripts/*.sh

# Pipelines in if conditions
grep -n "if.*|" scripts/*.sh

# Subshells with pipelines
grep -n "\$(.*|" scripts/*.sh
```

## set -e Pitfalls

`set -e` (exit on error) has exceptions that can surprise:

```bash
set -e

# These do NOT trigger exit:
cmd || true           # Explicit fallback
if cmd; then ...      # Part of condition
cmd && other          # Part of AND/OR list
while cmd; do ...     # Loop condition

# This DOES trigger exit:
cmd                   # Standalone command that fails
```

## Subshell Exit Codes

```bash
# BAD - subshell exit code lost
(cd /tmp && failing_command)
echo "This runs even if failing_command failed"

# GOOD - check subshell result
if ! (cd /tmp && failing_command); then
    echo "Failed"
    exit 1
fi

# GOOD - use || to handle failure
(cd /tmp && failing_command) || { echo "Failed"; exit 1; }
```

## Common Patterns to Flag

| Pattern | Risk | Fix |
|---------|------|-----|
| `cmd \| grep` in `if` | Exit code from grep | pipefail or capture |
| `$(cmd \| filter)` | Exit code from filter | PIPESTATUS or capture |
| `cmd \| head -1` | Loses cmd failure | pipefail |
| `cmd 2>&1 \| tee log` | May hide failure | pipefail |
| `set -e` + pipes | Inconsistent behavior | Explicit checks |
