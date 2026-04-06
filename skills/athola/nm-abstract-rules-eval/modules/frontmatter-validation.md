# Frontmatter Validation

## Valid Frontmatter Fields

Claude Code rules support these frontmatter fields:

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `paths` | `list[string]` | No | Glob patterns for conditional loading |
| `description` | `string` | No | Brief description of rule purpose |

Rules without `paths` are unconditional (apply to all files).

## Common Errors

### YAML Syntax Errors
```yaml
# INVALID - unquoted glob starting with *
---
paths:
  - **/*.ts        # YAML parse error
---

# VALID - quoted glob
---
paths:
  - "**/*.ts"
---
```

### Wrong Field Names
```yaml
# INVALID - Cursor-specific fields
---
globs:             # Wrong! Use 'paths'
  - "*.ts"
alwaysApply: true  # Wrong! Cursor-only, not Claude Code
---
```

### Invalid Structure
```yaml
# INVALID - paths must be a list
---
paths: "**/*.ts"   # Should be a list
---

# VALID
---
paths:
  - "**/*.ts"
---
```

## Scoring (25 points, deductive)

Starts at 25, deducts for issues found:

| Issue | Deduction | Criteria |
|-------|-----------|----------|
| YAML parse error | -25 | Frontmatter fails to parse |
| Cursor-specific field | -5 each | `globs`, `alwaysApply`, etc. |
| Invalid `paths` type | -5 | `paths` is not a list |
| Unknown field | -2 each | Field not in valid set |
| Empty `paths` list | -1 | `paths: []` (likely unintended) |
