# Optimization Techniques for Large Skills

Systematic methodology to reduce skill file size through externalization, consolidation, and progressive loading patterns.

## When To Use

**Symptoms that trigger optimization:**
- Skills-eval validation shows "[WARN] Large skill file" warnings
- SKILL.md files exceed 300 lines
- Multiple code blocks (10+) with similar functionality
- Heavy Python implementations inline with markdown
- Functions >20 lines embedded in documentation

## Core Pattern: Externalize-Consolidate-Progress

### Transformation Pattern

**Before**: 654-line skill with heavy inline Python implementations
**After**: ~150-line skill with external tools and references

**Key Changes:**
- Externalize heavy implementations (>20 lines) to dedicated tools
- Consolidate similar functions with parameterization
- Replace code blocks with structured data and tool references
- Implement progressive loading for non-essential content

## Size Reduction Strategies

| Strategy | Impact | When to Use |
|----------|--------|-------------|
| **Externalize Python modules** | 60-70% reduction | Heavy implementations (>20 lines) |
| **Consolidate similar functions** | 15-20% reduction | Repeated patterns with minor variations |
| **Replace code with structured data** | 10-15% reduction | Configuration-driven logic |
| **Progressive loading patterns** | 5-10% reduction | Multi-stage workflows |

## File Organization
```
skill-name/
  SKILL.md              # Core documentation (~150-200 lines)
  modules/
    examples.md         # Usage examples and anti-patterns
    patterns.md         # Detailed implementation patterns
  tools/
    analyzer.py         # Heavy implementations with CLI
    config.yaml         # Structured data
  examples/
    basic-usage.py      # Minimal working example
```

## Optimization Workflow

### Phase 1: Analysis
- Identify files >300 lines
- Count code blocks and functions
- Measure inline code vs documentation ratio
- Find repeated patterns and similar functions

### Phase 2: Externalization
- Move heavy implementations (>20 lines) to separate files
- Add CLI interfaces to externalized tools
- Create tool directory structure
- Add usage examples for each tool

### Phase 3: Consolidation
- Merge similar functions with parameterization
- Replace code blocks with structured data where appropriate
- Implement progressive loading for non-essential content
- Update skill documentation to reference external tools

### Phase 4: Validation
- Verify line count <300 (target: 150-200)
- Test all externalized tools work correctly
- Confirm progressive loading functions
- Run skills-eval validation to verify size reduction

## Quick Decision Tree

```
Is skill >300 lines?
+-- No -> Continue as-is
+-- Yes -> Analyze composition
    +-- Has heavy code blocks (>20 lines)?
    |   -> Externalize to tools/ with CLI (60-70% reduction)
    +-- Has repeated patterns?
    |   -> Consolidate with parameterization (15-20% reduction)
    +-- Has structured config data embedded?
    |   -> Extract to config.yaml (10-15% reduction)
    +-- Has non-essential details?
        -> Use progressive loading (5-10% reduction)
```

## Key Success Factors

**DO:**
- Always add CLI interfaces to external tools
- Keep core concepts inline in SKILL.md
- Consolidate related functionality
- Include working examples
- Test all tools have correct references

**DON'T:**
- Externalize without CLI (hard to use/test)
- Create too many small files (increases complexity)
- Remove essential documentation (reduces discoverability)
- Add complex dependencies (hard to maintain)
- Skip usage examples (unclear tool usage)

## Expected Outcome

- 50-70% line count reduction
- 40-60% token usage reduction
- No skills-eval warnings
- Clear separation of concerns
- Maintainable external tools with CLI interfaces
