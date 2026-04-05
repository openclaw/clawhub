---
parent_skill: pensive:makefile-review
module: best-practices
description: Makefile structure patterns, examples, and anti-patterns to avoid
tags: [best-practices, patterns, anti-patterns, examples]
---

# Makefile Best Practices

## Structure Pattern

Recommended organization:
```makefile
# 1. Variables at top
PROJECT := myproject
SRC_DIR := src
BUILD_DIR := build
VERSION := 1.0.0

# 2. Default goal
.DEFAULT_GOAL := help

# 3. PHONY declarations
.PHONY: all build test clean help

# 4. Help target (self-documenting)
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "%-15s %s\n", $$1, $$2}'

# 5. Main targets with inline docs
build: ## Build the project
	$(MAKE) -C $(SRC_DIR)

test: build ## Run tests
	pytest tests/

clean: ## Clean build artifacts
	rm -rf $(BUILD_DIR)
```

## Pattern Rule Examples

### File Conversion
```makefile
# Markdown to HTML
%.html: %.md
	pandoc $< -o $@

# Source to object
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c
	@mkdir -p $(@D)
	$(CC) $(CFLAGS) -c $< -o $@

# Template expansion
%/config.json: templates/config.json.tmpl
	@mkdir -p $(@D)
	envsubst < $< > $@
```

### Testing Patterns
```makefile
# Test by subdirectory
test-%:
	pytest tests/$*

# Test by type
test-unit test-integration test-e2e: test-%:
	pytest tests/$* -v
```

## Function Examples

### Reusable Command Sequences
```makefile
define run_tests
	@echo "Testing $(1)..."
	cd $(1) && pytest -v
	@echo "Done: $(1)"
endef

test-all:
	$(call run_tests,module1)
	$(call run_tests,module2)
```

### Multi-line Recipes
```makefile
define docker_build
	docker build \
		--build-arg VERSION=$(VERSION) \
		--tag $(1):$(VERSION) \
		--tag $(1):latest \
		.
endef

image:
	$(call docker_build,$(PROJECT))
```

## Anti-Patterns to Avoid

### Repeated Commands
```makefile
# Bad - duplicated logic
test-unit:
	pytest tests/unit

test-integration:
	pytest tests/integration

# Good - pattern rule
test-%:
	pytest tests/$*
```

### Missing PHONY
```makefile
# Bad - 'clean' file blocks target
clean:
	rm -rf build/

# Good
.PHONY: clean
clean:
	rm -rf build/
```

### Hardcoded Paths
```makefile
# Bad - not portable
clean:
	rm -rf /home/user/project/build

# Good - variables
BUILD_DIR ?= build
clean:
	rm -rf $(BUILD_DIR)
```

### Shell-Specific Commands
```makefile
# Bad - Bash-only
check:
	[[ -f config.yaml ]] && echo "Found"

# Good - POSIX compatible
check:
	[ -f config.yaml ] && echo "Found"
```

### Unguarded Variable References
```makefile
# Bad - fails if undefined
clean:
	rm -rf $(BUILD_DIR)

# Good - with default
BUILD_DIR ?= build
clean:
	rm -rf $(BUILD_DIR)
```

### Non-Idempotent Targets
```makefile
# Bad - appends every time
configure:
	echo "DEBUG=1" >> config.mk

# Good - idempotent
configure:
	@echo "DEBUG=1" > config.mk
```

## Error Handling

### Check Prerequisites
```makefile
.PHONY: check-deps
check-deps:
	@command -v python3 >/dev/null || (echo "python3 required"; exit 1)
	@command -v pytest >/dev/null || (echo "pytest required"; exit 1)

test: check-deps
	pytest tests/
```

### Delete on Error
```makefile
# Automatically delete targets on error
.DELETE_ON_ERROR:

build/%.o: src/%.c
	$(CC) $(CFLAGS) -c $< -o $@
```

### Pipeline Exit Code Propagation
```makefile
# Bad - pipeline exit code is from grep, not make
check:
	@$(MAKE) typecheck 2>&1 | grep -v "^make\["

# Good - capture exit code explicitly in wrapper scripts
# See shell-review skill for bash pipeline patterns
check:
	@$(MAKE) typecheck || { echo "Type check failed"; exit 1; }

# Good - use .SHELLFLAGS for pipefail in recipes
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
```

When recipes use pipelines, ensure exit codes propagate correctly. In bash, the default behavior is that pipeline exit code equals the last command's exit code. Use `set -o pipefail` or capture output and exit codes separately.

## Parallel Execution

```makefile
# Enable parallel by default
MAKEFLAGS += -j$(shell nproc 2>/dev/null || echo 1)

# Or disable for specific targets
.NOTPARALLEL: install deploy
```
