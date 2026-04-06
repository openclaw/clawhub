---
name: troubleshooting
description: Common issues and solutions for modular skills development with diagnostic tools and debugging strategies
category: troubleshooting
tags: [troubleshooting, debugging, modular-skills, diagnostics, common-issues]
dependencies: [modular-skills]
tools: [module_validator]
complexity: intermediate
estimated_tokens: 600
---

# Modular Skills Troubleshooting

## Common Issues and Solutions

### Module Validation Failures

**Issue**: `module_validator` reports structural violations or compliance issues

```bash
# Check specific skill with verbose output
scripts/module_validator -s path/to/skill.md --verbose

# Validate YAML frontmatter specifically
scripts/module_validator -s path/to/skill.md -c
```

**Common Solutions**:
- **Missing Required Fields**: validate `name`, `description`, and `category` are present in YAML frontmatter
- **Invalid YAML**: Check for proper indentation and syntax in frontmatter
- **Token Limits**: Verify estimated tokens are reasonable for skill complexity
- **Tool References**: validate all listed tools are accessible and executable

### Inaccurate Token Estimations

**Issue**: Token counts don't match actual usage or seem incorrect

```bash
# Get detailed token breakdown
scripts/token-estimator -f path/to/skill.md -v

# Compare design alternatives
scripts/token-estimator -f design1.md > design1_tokens.txt
scripts/token-estimator -f design2.md > design2_tokens.txt
```

**Common Solutions**:
- **Code Block Weighting**: Code blocks use more tokens - consider externalizing large examples
- **Content Duplication**: Remove repeated content and use references instead
- **Verbose Descriptions**: Condense explanations while maintaining clarity
- **Example Bloat**: Move complex examples to separate files or modules

### Skills Still Inefficient After Applying Patterns

**Issue**: Despite following modular design patterns, skills remain inefficient

```bash
# Analyze dependency depth and complexity
scripts/skill-analyzer --path path/to/skill.md --threshold 100

# Check if skill should be split
scripts/skill-analyzer --path path/to/skill.md --verbose
```

**Common Solutions**:
- **Module Granularity**: Break down larger modules into smaller, focused components
- **Dependency Optimization**: Reduce inter-module dependencies and coupling
- **Content Organization**: Reorganize content for better progressive disclosure
- **Tool Integration**: Add executable tools to reduce manual overhead

### Tools Not Loading Correctly

**Issue**: Executable tools are not accessible or fail to run

```bash
# Check tool permissions
ls -la scripts/

# Make tools executable
find scripts/ -type f -exec chmod +x {} \;

# Test individual tools
scripts/skill-analyzer --help
```

**Common Solutions**:
- **File Permissions**: validate all tools have execute permissions (`chmod +x`)
- **Path Issues**: Verify tools are in correct directory structure
- **Python Dependencies**: Install required packages (`pip install -r requirements.txt`)
- **Shebang Lines**: validate Python scripts have proper `#!/usr/bin/env python3`

## Advanced Troubleshooting

### Complexity Analysis Discrepancies

**Issue**: Different analysis tools give conflicting complexity assessments

```bash
# Use custom threshold for strict evaluation
scripts/skill-analyzer --path path/to/skill.md --threshold 50

# Analyze all skills in directory
scripts/skill-analyzer --path path/to/skills/ --verbose
```

**Diagnostic Approaches**:
- **Threshold Tuning**: Adjust complexity thresholds based on your specific requirements
- **Multi-Tool Analysis**: Compare results from different analysis tools
- **Context Consideration**: Consider skill complexity in relation to its purpose
- **Historical Tracking**: Monitor complexity changes over time

### Module Design Issues

**Issue**: Modules don't follow best practices or have structural problems

```bash
# Validate against modular design principles
scripts/module_validator -d path/to/skills/ --fail-on-warnings

# Check for structural violations
scripts/module_validator -s path/to/skill.md --verbose
```

**Design Validation Checklist**:
- **Single Responsibility**: Each module has one clear purpose
- **Clear Boundaries**: Well-defined interfaces and responsibilities
- **Minimal Coupling**: Low inter-module dependencies
- **High Cohesion**: Related functionality grouped together
- **Explicit Dependencies**: All dependencies clearly declared

### Performance Optimization

**Issue**: Skills are slow to load or consume excessive resources

```bash
# Token usage analysis
scripts/token-estimator -d path/to/skills/

# Identify optimization opportunities
scripts/skill-analyzer --path path/to/skill.md | grep -i recommend
```

**Optimization Strategies**:
- **Progressive Loading**: Load essential content first, details later
- **Content Compression**: Remove redundant explanations and examples
- **External Resources**: Move large datasets or examples to separate files
- **Caching**: Implement caching for frequently accessed modules
- **Lazy Loading**: Load modules only when actually needed

## Design Pattern Validation

### Single Responsibility Principle
- Each module serves one clear purpose
- No mixed concerns or responsibilities
- Focused, cohesive functionality
- Clear scope and boundaries

**Validation Questions**:
- Can this module be described in a single sentence?
- Does the module address only one concern?
- Would splitting this module create more complexity?

### Loose Coupling
- Minimal dependencies between modules
- Clear interfaces and boundaries
- Independent testability
- No circular dependencies

**Validation Questions**:
- Can this module be tested in isolation?
- Are dependencies minimal and explicit?
- Would changing another module break this one?

### High Cohesion
- Related functionality grouped together
- Consistent patterns within modules
- Logical organization
- Unified purpose

**Validation Questions**:
- Do all parts of this module belong together?
- Is the module organization logical and consistent?
- Would moving functionality improve or hurt organization?

### Clear Boundaries
- Well-defined interfaces and responsibilities
- Explicit dependency relationships
- No hidden or circular dependencies
- Clear entry and exit points

**Validation Questions**:
- Are module boundaries clearly defined?
- Is it obvious what belongs in vs. outside the module?
- Are all dependencies explicitly declared?

## Getting Help

### Analysis Mode
Use `--verbose` flag for detailed breakdowns:
```bash
scripts/skill-analyzer --verbose --path skill.md
```

### Help System
All tools support `--help` for usage guidance:
```bash
scripts/module_validator --help
scripts/token-estimator --help
```

### Custom Thresholds
Adjust analysis parameters with `--threshold`:
```bash
scripts/skill-analyzer --threshold 100 --path skill.md
```

### Batch Analysis
Process multiple skills with directory paths:
```bash
scripts/skill-analyzer --path path/to/skills/
scripts/token-estimator -d path/to/skills/
```

### Validation Scripts
Use `--fail-on-warnings` for strict checking:
```bash
scripts/module_validator --fail-on-warnings -s skill.md
```
