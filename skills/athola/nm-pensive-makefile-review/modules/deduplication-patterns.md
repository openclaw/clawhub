---
parent_skill: pensive:makefile-review
module: deduplication-patterns
description: Detect and eliminate recipe duplication using pattern rules and functions
tags: [deduplication, pattern-rules, functions, automatic-variables]
---

# Deduplication Patterns

## Recipe Duplication Detection

Search for repeated command patterns:
```bash
# Common test commands
rg -n "cargo test" -g'Makefile*'
rg -n "pytest" -g'Makefile*'
rg -n "npm run" -g'Makefile*'
rg -n "go test" -g'Makefile*'

# Build commands
rg -n "docker build" -g'Makefile*'
rg -n "gcc.*-o" -g'Makefile*'
```

## Pattern Rules

Replace repeated rules with patterns:
```makefile
# Bad - repeated
test-unit:
	pytest tests/unit

test-integration:
	pytest tests/integration

test-e2e:
	pytest tests/e2e

# Good - pattern rule
test-%:
	pytest tests/$*
```

Pattern rule for file conversion:
```makefile
# Convert all .md to .html
%.html: %.md
	pandoc $< -o $@

# Build objects from sources
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c
	$(CC) $(CFLAGS) -c $< -o $@
```

## Static Pattern Rules

For specific targets with patterns:
```makefile
SOURCES := foo.c bar.c baz.c
OBJECTS := $(SOURCES:.c=.o)

$(OBJECTS): %.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@
```

## Functions and Define Blocks

Reusable command sequences:
```makefile
# Define reusable function
define run_tests
	@echo "Testing $(1)..."
	cd $(1) && pytest
endef

test-all:
	$(call run_tests,module1)
	$(call run_tests,module2)
```

Multi-line define blocks:
```makefile
define install_package
	@echo "Installing $(1)..."
	pip install --quiet $(1)
	@echo "Done: $(1)"
endef

deps:
	$(call install_package,pytest)
	$(call install_package,black)
```

## Automatic Variables Reference

Use automatic variables to reduce duplication:

| Variable | Meaning | Use Case |
|----------|---------|----------|
| `$@` | Target name | Output file path |
| `$<` | First prerequisite | Main input file |
| `$^` | All prerequisites | Link all objects |
| `$?` | Newer prerequisites | Incremental builds |
| `$*` | Stem match | Pattern rule matching |
| `$(@D)` | Directory of target | mkdir parent |
| `$(<D)` | Directory of first prerequisite | Source dirs |

Example:
```makefile
# Before
build/foo.o: src/foo.c
	$(CC) $(CFLAGS) -c src/foo.c -o build/foo.o

# After
build/%.o: src/%.c
	$(CC) $(CFLAGS) -c $< -o $@
```

## Clean Target Best Practices

```makefile
# Good - use variables, don't duplicate paths
BUILD_DIR ?= build
DIST_DIR ?= dist

.PHONY: clean distclean

clean:
	rm -rf $(BUILD_DIR)

distclean: clean
	rm -rf $(DIST_DIR)
```
