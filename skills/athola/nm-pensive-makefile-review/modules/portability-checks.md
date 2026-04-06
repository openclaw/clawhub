---
parent_skill: pensive:makefile-review
module: portability-checks
description: Cross-platform compatibility and POSIX vs GNU Make feature detection
tags: [portability, posix, gnu-make, cross-platform]
---

# Portability Checks

## GNU Make Features

Check for GNU-specific features that may not be portable:

### Advanced Directives
```bash
rg -n "^\\.ONESHELL:" -g'Makefile*'
rg -n "^\\.NOTPARALLEL:" -g'Makefile*'
rg -n "^\\.DELETE_ON_ERROR:" -g'Makefile*'
```

- `.ONESHELL` - Single shell per recipe (GNU Make 3.82+)
- `.NOTPARALLEL` - Disable parallel execution
- `.DELETE_ON_ERROR` - Delete targets on error

### Order-Only Prerequisites
```bash
rg -n "\|[^|]" -g'Makefile*'
```

Order-only prerequisites (`target: normal | order-only`) are GNU Make only.

### GNU Functions
```bash
rg -n "\$\(shell " -g'Makefile*'
rg -n "\$\(wildcard " -g'Makefile*'
rg -n "\$\(foreach " -g'Makefile*'
rg -n "\$\(eval " -g'Makefile*'
```

Common GNU functions:
- `$(shell ...)` - Execute shell command
- `$(wildcard pattern)` - File globbing
- `$(foreach var,list,text)` - Loop
- `$(eval text)` - Dynamic evaluation

## POSIX Compatibility

For maximum portability:
```makefile
# POSIX-compatible shell
SHELL := /bin/sh

# Avoid Bash-specific features
# - Arrays: arr=(1 2 3)
# - [[ ]]: use [ ] instead
# - Process substitution: <(cmd)
# - Brace expansion: {1..10}
```

## Shell Configuration

### Good: POSIX Compatible
```makefile
SHELL := /bin/sh
```

### If Bash Required
Document and configure properly:
```makefile
# Requires Bash 4.0+
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

# -e: exit on error
# -u: error on undefined variable
# -o pipefail: pipe fails if any command fails
# -c: execute command
```

## Cross-Platform Safety

### Path Separators
```makefile
# Good - portable
SRC_DIR := src
BUILD_DIR := build

# Bad - hardcoded separator
SRC_DIR := src/main/resources
```

### Command Portability
```makefile
# Check for required commands
ifeq ($(shell command -v pandoc 2>/dev/null),)
$(error pandoc is required but not installed)
endif
```

### Platform Detection
```makefile
UNAME := $(shell uname -s)

ifeq ($(UNAME),Linux)
  # Linux-specific
endif
ifeq ($(UNAME),Darwin)
  # macOS-specific
endif
```

## Quality Gate Targets

validate standard targets exist:
```bash
rg -n "^help:" -g'Makefile*'
rg -n "^format:" -g'Makefile*'
rg -n "^lint:" -g'Makefile*'
rg -n "^test:" -g'Makefile*'
rg -n "^build:" -g'Makefile*'
rg -n "^clean:" -g'Makefile*'
```

Recommended targets:
- `help` - Show available targets
- `format` - Code formatting
- `lint` - Linting checks
- `test` - Run test suite
- `build` - Build artifacts
- `clean` - Clean build artifacts
- `release` - Production build
- `install` - Install artifacts
