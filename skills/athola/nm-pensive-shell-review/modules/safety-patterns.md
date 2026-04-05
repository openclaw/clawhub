---
parent_skill: pensive:shell-review
module: safety-patterns
description: Defensive scripting patterns and common security pitfalls
tags: [safety, security, defensive, quoting, set-flags]
---

# Shell Safety Patterns

## Essential Set Flags

Start scripts with defensive flags:

```bash
#!/usr/bin/env bash
set -euo pipefail

# -e: Exit on error (with caveats - see exit-codes module)
# -u: Error on undefined variables
# -o pipefail: Pipeline fails if any command fails
```

### When to Use Each

| Flag | Use When | Skip When |
|------|----------|-----------|
| `-e` | Most scripts | Complex error handling needed |
| `-u` | Always | Legacy scripts with expected unset vars |
| `-o pipefail` | Using pipelines | Intentionally ignoring early failures |

## Variable Quoting

### Always Quote Variables

```bash
# BAD - breaks on spaces, globs
rm -rf $BUILD_DIR/*
cd $PROJECT_ROOT

# GOOD - safe
rm -rf "$BUILD_DIR"/*
cd "$PROJECT_ROOT"
```

### Detection

```bash
# Find unquoted variables (rough heuristic)
grep -n '\$[A-Za-z_][A-Za-z_0-9]*[^"]' scripts/*.sh
```

### Special Cases

```bash
# Array expansion - no quotes for word splitting
for item in ${ITEMS[@]}; do  # Intentional splitting

# Glob expansion - no quotes
for file in *.txt; do  # Intentional globbing

# Here - use [[ ]] which doesn't word-split
if [[ $var == pattern* ]]; then  # Safe in [[
```

## Safe Temporary Files

```bash
# BAD - predictable, race condition
TMPFILE=/tmp/myapp.tmp

# GOOD - mktemp
TMPFILE=$(mktemp)
trap "rm -f '$TMPFILE'" EXIT

# GOOD - with template
TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/myapp.XXXXXX")
trap "rm -rf '$TMPDIR'" EXIT
```

## Safe Directory Changes

```bash
# BAD - continues if cd fails
cd /some/path
rm -rf *  # Dangerous if cd failed!

# GOOD - fail if cd fails
cd /some/path || { echo "cd failed"; exit 1; }

# GOOD - use set -e
set -e
cd /some/path
```

## Safe Command Substitution

```bash
# BAD - fails silently
files=$(ls *.txt 2>/dev/null)

# GOOD - check result
if ! files=$(ls *.txt 2>/dev/null); then
    echo "No txt files found"
    exit 1
fi
```

## Avoid eval

```bash
# BAD - code injection risk
eval "$user_input"

# GOOD - use arrays for dynamic commands
cmd=("$program" "$arg1" "$arg2")
"${cmd[@]}"
```

## Safe Path Handling

```bash
# BAD - assumes paths have no spaces
for f in $(find . -name "*.txt"); do

# GOOD - handle all filenames safely
find . -name "*.txt" -print0 | while IFS= read -r -d '' f; do
    process "$f"
done

# GOOD - use glob (bash 4+)
shopt -s globstar nullglob
for f in **/*.txt; do
    process "$f"
done
```

## Checklist

- [ ] Script starts with `set -euo pipefail` or documents why not
- [ ] All variables are quoted unless intentionally splitting/globbing
- [ ] Temp files use mktemp with trap cleanup
- [ ] cd commands check for failure
- [ ] No eval with user input
- [ ] Pipelines checked for exit code propagation
- [ ] ShellCheck passes (if available)

## Automated Checking

```bash
# Run ShellCheck (if installed)
shellcheck scripts/*.sh

# Check for common issues
grep -rn 'rm -rf \$' scripts/      # Unquoted rm
grep -rn 'cd [^|&]*$' scripts/     # cd without error check
grep -rn 'eval ' scripts/           # eval usage
```
