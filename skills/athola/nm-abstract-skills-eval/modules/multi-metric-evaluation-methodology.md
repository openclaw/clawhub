# Multi-Metric Evaluation Methodology

Weighted multi-metric scoring for skill quality assessment. Covers compliance (30%), performance (25%), documentation (20%), and maintainability (25%) dimensions with vector normalization for scale invariance.

## Quick Reference

### Core Metrics

**Compliance (30%)**
- Required fields present
- Token limits respected
- Proper frontmatter structure

**Effectiveness (30%)**
- Clear triggers and use cases
- Actionable guidance
- Measurable outcomes

**Maintainability (20%)**
- Modular structure
- Clear documentation
- Version control

**Performance (20%)**
- Token efficiency
- Load time
- Context pressure

## Evaluation Workflow

```bash
# Run comprehensive evaluation
/skills-eval --skill my-skill --metrics all

# Focus on specific metrics
/skills-eval --skill my-skill --metrics compliance,effectiveness

# Generate detailed report
/skills-eval --skill my-skill --report --output report.md
```

## Score Interpretation

- **90-100**: Production ready
- **80-89**: Minor improvements recommended
- **70-79**: Moderate issues, review needed
- **<70**: Significant issues, refactor recommended

## See Complete Guide

The comprehensive methodology guide includes:
- Detailed metric definitions
- Weighted scoring algorithms
- Statistical analysis methods
- Benchmark comparisons
- Continuous improvement frameworks

Use `Skill(abstract:skills-eval)` to run the full evaluation pipeline against any skill.
