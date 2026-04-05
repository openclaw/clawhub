---
parent_skill: pensive:shell-review
module: portability
description: POSIX vs Bash compatibility and cross-platform considerations
tags: [posix, bash, portability, cross-platform]
---

# Shell Portability

## Shebang Lines

```bash
#!/bin/sh          # POSIX shell (most portable)
#!/bin/bash        # Bash (most features)
#!/usr/bin/env bash  # Bash via env (handles non-standard paths)
```

If using Bash features, use `#!/usr/bin/env bash` for portability across systems where bash may not be at `/bin/bash`.

## Bash-Only Features

These require `#!/bin/bash` or `#!/usr/bin/env bash`:

| Feature | Bash | POSIX Alternative |
|---------|------|-------------------|
| `[[ ... ]]` | Yes | `[ ... ]` |
| `(( ... ))` | Yes | `$(( ... ))` or `[ ... ]` |
| Arrays | Yes | Use files or positional params |
| `${var:offset:len}` | Yes | `expr` or external tools |
| `${var//pat/rep}` | Yes | `sed` |
| `<<<` here-string | Yes | `echo "$var" \|` |
| `<(cmd)` process sub | Yes | Temp files or pipes |
| `source file` | Yes | `. file` |
| `function name { }` | Yes | `name() { }` |
| `local -n` nameref | Bash 4.3+ | Workarounds |

## Detection Commands

```bash
# Find Bash-isms in #!/bin/sh scripts
grep -l "^#!/bin/sh" scripts/*.sh | while read f; do
    # Check for [[ ]]
    grep -n "\[\[" "$f" && echo "  ^ $f uses [[ ]]"
    # Check for arrays
    grep -n "=(" "$f" && echo "  ^ $f uses arrays"
done

# Find all shebang types
grep -h "^#!" scripts/*.sh | sort -u
```

## Common Portability Fixes

### Test Brackets

```bash
# BAD - Bash only
if [[ -f "$file" && "$var" == "value" ]]; then

# GOOD - POSIX
if [ -f "$file" ] && [ "$var" = "value" ]; then
```

### String Comparison

```bash
# BAD - Bash only (== works but not standard)
if [ "$a" == "$b" ]; then

# GOOD - POSIX
if [ "$a" = "$b" ]; then
```

### Arithmetic

```bash
# BAD - Bash only
((count++))
if (( count > 10 )); then

# GOOD - POSIX
count=$((count + 1))
if [ "$count" -gt 10 ]; then
```

### Local Variables

```bash
# BAD - 'local' is not POSIX (but widely supported)
local var="value"

# GOOD - explicitly use in functions only, document assumption
# Most modern shells support 'local', acceptable if documented
```

## macOS vs Linux

```bash
# sed -i differs
# Linux: sed -i 's/a/b/' file
# macOS: sed -i '' 's/a/b/' file

# Portable approach
sed 's/a/b/' file > file.tmp && mv file.tmp file

# Or detect platform
case "$(uname -s)" in
    Darwin*) SED_INPLACE="sed -i ''" ;;
    *)       SED_INPLACE="sed -i" ;;
esac
```

## Recommendation

1. Use `#!/usr/bin/env bash` and document Bash requirement
2. Or use `#!/bin/sh` and avoid ALL Bash-isms
3. Don't mix - pick one and be consistent
