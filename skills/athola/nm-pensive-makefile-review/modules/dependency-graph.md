---
parent_skill: pensive:makefile-review
module: dependency-graph
description: Make database inspection and dependency analysis
tags: [dependencies, phony, circular-deps, includes]
---

# Dependency Graph Analysis

## Make Database Inspection

Inspect the complete expanded database:
```bash
make -pn | less
```

This shows:
- All rules (implicit and explicit)
- Variable assignments
- Default values
- Pattern rules

## PHONY Detection

Check for `.PHONY` declarations:
```bash
rg -n "^\.PHONY:" -g'Makefile*'
```

Common PHONY targets that should be declared:
- `all`, `build`, `test`, `clean`, `install`
- `help`, `format`, `lint`, `release`
- `distclean`, `check`, `docs`

## Circular Dependency Checks

Look for circular dependencies:
```bash
make -pn 2>&1 | grep -i "circular"
```

Common patterns:
```makefile
# Bad - circular
A: B
B: A

# Good - linear
A: B
B: C
```

## Include File Patterns

Find include directives:
```bash
rg -n "^include|^-include" -g'Makefile*'
```

Check for:
- Redundant includes
- Missing includes
- Include order issues
- Conditional includes

Validate included files exist:
```bash
# List includes
rg "^include\s+(\S+)" -or '$1' -g'Makefile*'

# Check they exist
for f in $(rg "^include\s+(\S+)" -or '$1' -g'Makefile*'); do
  [ -f "$f" ] || echo "Missing: $f"
done
```
