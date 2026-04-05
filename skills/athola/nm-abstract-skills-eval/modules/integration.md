# Integration with Other Skills

## Complementary Skills

### modular-skills
- **Purpose**: Provides structural analysis and modular design patterns
- **Integration**: Uses `skill-analyzer` and `token-estimator` tools
- **Workflow**: Run structural analysis before detailed evaluation
- **Benefits**: validates proper modularization and token efficiency

```bash
# Combined workflow example
scripts/skill-analyzer --path skill.md --verbose
skills/skills-eval/scripts/compliance-checker --skill-path skill.md
skills/skills-eval/scripts/improvement-suggester --skill-path skill.md
```

### testing-skills
- **Purpose**: Validation and testing patterns for skills
- **Integration**: Compatible with test-driven development approaches
- **Workflow**: Use evaluation results to inform test coverage
- **Benefits**: detailed quality assurance across all dimensions

### documentation-standards
- **Purpose**: validates consistent documentation practices
- **Integration**: Aligns with documentation best practices
- **Workflow**: Use documentation evaluation as part of overall assessment
- **Benefits**: Unified documentation approach across skill ecosystem

### workflow-automation
- **Purpose**: Automates skill development and maintenance workflows
- **Integration**: Provides CI/CD patterns for skill management
- **Workflow**: Integrate evaluation into automated pipelines
- **Benefits**: Continuous quality monitoring and improvement

## Workflow Integration

### Development Pipeline
```bash
# Pre-commit evaluation
skills/skills-eval/scripts/compliance-checker --skill-path skill.md --auto-fix

# Post-development analysis
skills/skills-eval/scripts/skills-auditor --scan-all --format markdown
skills/skills-eval/scripts/improvement-suggester --skill-path skill.md --priority high
```

### Continuous Integration
```yaml
# Example CI configuration
evaluation_pipeline:
  steps:
    - name: "Compliance Check"
      run: skills/skills-eval/scripts/compliance-checker --directory . --format json
    - name: "Quality Assessment"
      run: skills/skills-eval/scripts/skills-auditor --scan-all
    - name: "Improvement Analysis"
      run: skills/skills-eval/scripts/improvement-suggester --directory .
```

### Monitoring and Alerting
- **Quality Thresholds**: Set minimum acceptable scores
- **Performance Metrics**: Monitor token usage and activation rates
- **Security Scanning**: Regular compliance and security checks
- **Trend Analysis**: Track quality improvements over time

## Best Practices

### Evaluation Frequency
- **Pre-commit**: Quick compliance and security checks
- **Pre-release**: detailed evaluation and improvement planning
- **Periodic**: Quarterly full-skill inventory and assessment
- **Triggered**: After major changes or updates

### Integration Strategies
1. **Progressive Enhancement**: Start with basic evaluation, add advanced features
2. **Custom Thresholds**: Set quality gates appropriate to your context
3. **Automated Workflows**: Integrate evaluation into development pipelines
4. **Continuous Improvement**: Use evaluation results for ongoing optimization

### Tool Orchestration
- **Discovery First**: Always run skills discovery before detailed analysis
- **Prioritization**: Use improvement suggester to focus efforts
- **Validation**: Verify fixes with compliance checker
- **Monitoring**: Track quality metrics over time
