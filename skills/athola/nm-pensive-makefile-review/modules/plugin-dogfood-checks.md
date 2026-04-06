# Plugin Dogfood Checks

Analyzes Makefiles to identify gaps in user-facing functionality, safely tests existing targets, and generates missing targets with contextually appropriate templates.

## Overview

This module provides detailed Makefile analysis and enhancement for the claude-night-market project. It validates that all plugins have complete, consistent, and functional Makefile targets that support common user workflows.

## Workflow

### 1. Discovery Phase
```bash
makefile_dogfooder.py --scope all --mode analyze
```

The discovery phase:
- Recursively searches for Makefile, makefile, GNUmakefile, and *.mk files
- Parses target definitions with dependencies and commands
- Extracts variable assignments and include statements
- Builds dependency graphs and detects plugin type (leaf vs aggregator)

### 2. Analysis Phase
```bash
makefile_dogfooder.py --mode analyze --output json
```

The analysis phase evaluates:
- **Essential targets** (help, clean, .PHONY) - 20 points each
- **Recommended targets** (test, lint, format, install, status) - 10 points each
- **Convenience targets** (demo, dogfood, check, quick-run) - 5 points each
- **Anti-patterns** (missing .PHONY, no error handling)
- **Consistency** across multiple Makefiles

### 3. Testing Phase
```bash
makefile_dogfooder.py --mode test
```

The testing phase performs:
- Syntax validation with `make -n`
- Help target functionality checks
- Variable dependency verification
- Common runtime issue detection

### 4. Generation Phase
```bash
makefile_dogfooder.py --mode full --apply
```

The generation phase creates:
- **Demo targets** to showcase plugin functionality
- **Dogfood targets** for self-testing
- **Quick-run targets** for common workflows
- **Check-all targets** for aggregator Makefiles

## Best Practices

### For Leaf Plugins
- Always include: help, clean, test, lint
- Add demo target to showcase functionality
- Include dogfood target for self-testing
- Use shared includes from abstract when possible

### For Aggregator Makefiles
- Delegate to plugin Makefiles with pattern targets
- Include check-all target for detailed validation
- Maintain consistent target naming across plugins
- Provide helpful aggregate status information

### Target Naming
- Use kebab-case for target names
- Include brief description with `##` comment
- Group related targets with prefixes (test-, dev-, docs-)
- Follow alphabetical ordering for readability

## Demo Target Philosophy

Demo targets must run ACTUAL functionality, not just echo static information.

| BAD (Static/Informational) | GOOD (Live/Functional) |
|-------------------------------|---------------------------|
| `@echo "Skills: 5"` | `$(UV_RUN) python scripts/validator.py --scan` |
| `@find skills/ \| wc -l` | `$(UV_RUN) python scripts/cli.py analyze .` |
| `@echo "Feature: validation"` | `$(UV_RUN) python scripts/validator.py --target .` |

## Integration

### With Slash Commands
```bash
/make-dogfood --scope plugins --mode full
```

### With CI/CD
```yaml
- name: Validate Makefiles
  run: makefile_dogfooder.py --mode test --output json
```

## Scoring

Each Makefile is scored 0-100 based on target coverage:
- Essential targets: 20 points each
- Recommended targets: 10 points each
- Convenience targets: 5 points each
- Anti-pattern penalties: -5 to -10 each
